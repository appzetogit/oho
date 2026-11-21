import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './modules/taxi/middlewares/errorMiddleware.js';
import { taxiRouter } from './modules/taxi/routes/index.js';

export const createApp = () => {
  const app = express();

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true })); 
  // The standard "combined" line plus how long the request took, so slow
  // endpoints show up in the logs. Appended at the end so anything reading the
  // usual fields keeps working.
  app.use(morgan(
    env.nodeEnv === 'production'
      ? ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms'
      : 'dev',
  ));

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // Uploaded files get a unique name (timestamp + random) and are never
  // overwritten, so phones can keep them. They were sent with max-age=0, so the
  // same few vehicle icons were downloaded ~1,600 times a day. App images under
  // legacy/ may be cached anywhere for 30 days; everything else (driver
  // documents among it) only on the device itself, never by shared caches.
  app.use("/uploads", express.static(path.join(__dirname, "../uploads"), {
    setHeaders: (res, filePath) => {
      const isAppImage = filePath.split(path.sep).includes('legacy');
      res.setHeader(
        'Cache-Control',
        isAppImage ? 'public, max-age=2592000, immutable' : 'private, max-age=604800',
      );
    },
  }));

  app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'Taxi backend is healthy' });
  });

  // Keep both mounts during integration so existing clients using /api or /api/v1 continue to work.
  app.use('/api', taxiRouter);
  app.use('/api/v1', taxiRouter);

  app.get(['/api', '/api/v1'], (_req, res) => {
    res.json({
      success: true,
      message: 'Taxi API is mounted',
      routes: {
        admins: ['/api/admin', '/api/v1/admin'],
        users: ['/api/users', '/api/v1/users'],
        drivers: ['/api/drivers', '/api/v1/drivers'],
        rides: ['/api/rides', '/api/v1/rides'],
        deliveries: ['/api/deliveries', '/api/v1/deliveries'],
      },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
