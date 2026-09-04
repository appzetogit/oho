import { createServer } from 'node:http';
import { createApp } from './src/app.js';
import { connectDatabase } from './src/config/database.js';
import { env } from './src/config/env.js';
import { connectRedis, getRedisStatus } from './src/infrastructure/redis/redisClient.js';
import { configureTaxiSocketServer } from './src/modules/taxi/socket/index.js';
import { User } from './src/modules/taxi/user/models/User.js';
import { restoreScheduledDispatches, startDispatchRecoveryLoop } from './src/modules/taxi/services/dispatchService.js';

const bootstrap = async () => {
  await connectDatabase();
  if (!env.redis.enabled || !env.redis.url) {
    console.warn('[redis] disabled or not configured, falling back to in-memory rate limiting');
  } else {
    const redisClient = await connectRedis();
    if (!redisClient?.isReady) {
      console.warn('[redis] startup connect did not complete; app will continue and fall back to in-memory rate limiting until Redis is ready');
    }
  }

  const app = createApp();
  const httpServer = createServer(app);

  const io = await configureTaxiSocketServer(httpServer);
  await restoreScheduledDispatches();
  startDispatchRecoveryLoop();

  // Loopback by default: nginx is the only thing that should reach these
  // processes, and with several instances on 5000-5003 a public bind would let
  // a client pin one instance and skip the load balancer entirely. Set HOST to
  // override where the proxy lives elsewhere (containers, another box).
  const host = process.env.HOST || '127.0.0.1';

  httpServer.listen(env.port, host, () => {
    const redisStatus = getRedisStatus();
    console.log(`Taxi backend listening on ${host}:${env.port}`);
    console.log('[redis] status', redisStatus);

    // Tell pm2 (wait_ready) that this process is actually serving. Booting
    // takes ~13s, almost all of it module loading, so without this pm2 would
    // kill the old process long before the new one can answer and every deploy
    // would be a ~13s window of 502s.
    if (typeof process.send === 'function') {
      process.send('ready');
    }
  });

  // Stop accepting new connections, let in-flight requests finish, then exit.
  // pm2 sends SIGINT on reload and SIGKILLs after kill_timeout.
  //
  // httpServer.close() alone never resolves here: it waits for every open
  // connection, and the socket.io websockets stay open indefinitely by design.
  // So close the sockets first and drop idle keep-alives, leaving only genuine
  // in-flight requests to drain.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining`);

    const done = (code) => process.exit(code);

    // Disconnecting tells clients to reconnect immediately; the other worker
    // is already serving, so they land there instead of hanging on this one.
    io.close();
    httpServer.closeIdleConnections();

    const forceExit = setTimeout(() => {
      console.warn('[shutdown] in-flight requests still open, forcing close');
      httpServer.closeAllConnections();
      done(0);
    }, 8000);
    forceExit.unref();

    httpServer.close((err) => {
      clearTimeout(forceExit);
      if (err) {
        console.error('[shutdown] error closing server', err);
        return done(1);
      }
      console.log('[shutdown] drained cleanly');
      return done(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

bootstrap().catch((error) => {
  console.error('Failed to start taxi backend', error);
  process.exit(1);
});
