module.exports = {
  apps: [{
    name: 'wcd-backend',
    script: 'server.js',
    instances: 2,           // 2 processes for zero-downtime reloads; PM2 load-balances
    exec_mode: 'cluster',   // PM2 cluster mode (Node.js cluster code removed from server.js)
    env: {
      NODE_ENV: 'production',
      PORT: 5002,
      ENABLE_CRON: 'true'
    },
    // Graceful reload: app calls process.send('ready') once DB is up
    wait_ready: true,
    listen_timeout: 15000,  // wait up to 15s for process.send('ready')
    kill_timeout: 10000,    // allow 10s for graceful shutdown before SIGKILL

    // Restart policy
    max_memory_restart: '500M',
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    autorestart: true,

    // Logging
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
