/**
 * pm2 process config.
 *
 * Deploy with a RELOAD, never a restart:
 *   pm2 reload ecosystem.config.cjs --update-env
 *
 * `restart` kills the process and starts a new one, and this app takes ~13s to
 * boot (almost entirely ESM module loading), so a restart means ~13s of 502s.
 * `reload` starts the replacement first, waits for it to signal `ready`, and
 * only then retires the old one — so something is always answering.
 *
 * Deliberately CommonJS (.cjs): package.json sets "type": "module", and pm2
 * reads this file with require().
 */

module.exports = {
  apps: [
    {
      name: 'oho-api',
      script: './server.js',
      cwd: '/home/ohoridein/apps/oho/Backend',
      interpreter: '/home/ohoridein/.local/node20/bin/node',

      // Cluster mode lets several workers share one listening socket, so nginx
      // keeps pointing at a single port and needs no upstream config.
      exec_mode: 'cluster',
      instances: 2,

      // Wait for server.js to process.send('ready') rather than assuming the
      // process is up the moment it spawns. listen_timeout must comfortably
      // exceed the ~13s boot or pm2 will give up and kill a healthy worker.
      wait_ready: true,
      listen_timeout: 40000,

      // On reload pm2 sends SIGINT; server.js stops accepting connections and
      // lets in-flight requests drain. This is the hard ceiling after that.
      kill_timeout: 12000,

      // The box runs other projects and sits under memory pressure, so cap a
      // worker that leaks rather than letting it push the host into swap.
      max_memory_restart: '400M',

      env: {
        NODE_ENV: 'production',
      },

      merge_logs: true,
      time: true,
      autorestart: true,
      // A worker that dies instantly and repeatedly is broken, not unlucky;
      // back off instead of spinning.
      min_uptime: 20000,
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
