module.exports = {
  apps: [{
    name: 'wcd-backend',
    script: 'server.js',
    instances: 2,              // 2 instances for zero-downtime reloads
    exec_mode: 'cluster',       // Cluster mode for load balancing
    env: {
      NODE_ENV: 'production',
      PORT: 5000,              // Changed to port 5000
      ENABLE_CLUSTER: 'false', // Let PM2 handle clustering, not Node.js
      ENABLE_CRON: 'true'
    },
    // Graceful reload settings
    wait_ready: true,
    listen_timeout: 10000,
    kill_timeout: 5000,
    
    // Health check settings
    health_check_grace_period: 3000,    // 3 seconds grace period
    health_check_fatal_exceptions: true,
    
    // Memory and restart settings
    max_memory_restart: '500M',    // Restart if memory exceeds 500MB
    min_uptime: '10s',             // Minimum uptime before considering stable
    max_restarts: 10,              // Max restarts per app
    restart_delay: 4000,           // Delay between restarts (4 seconds)
    autorestart: true,             // Auto-restart on crash
    
    // Logging
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
