// =============================================================================
// PRODUCTION-READY SERVER WITH CLUSTER MODE
// =============================================================================

require('dotenv').config();

// Set timezone to UTC for consistent timestamps
process.env.TZ = 'UTC';

const cluster = require('cluster');
const os = require('os');
const app = require('./app');
const { testConnection, closeConnection } = require('./config/db');
const { initCronJobs } = require('./cron/scheduler');
const logger = require('./config/logger');
const slowQueryLogger = require('./config/slowQueryLogger');
const systemHealthLogger = require('./config/systemHealthLogger');
const cache = require('./utils/cache');
const { syncAllPermissions } = require('./utils/syncPermissions');

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ENABLE_CLUSTER = process.env.ENABLE_CLUSTER === 'true' && NODE_ENV === 'production';
const ENABLE_CRON = process.env.ENABLE_CRON !== 'false';

// Worker process
if (ENABLE_CLUSTER && cluster.isWorker) {
  const server = app.listen(PORT, async () => {
    logger.info(`Worker ${cluster.worker.id} started on port ${PORT}`);
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database, exiting...');
      process.exit(1);
    }
    
    // Sync permissions to database (only in first worker to avoid conflicts)
    if (cluster.worker.id === 1) {
      try {
        await syncAllPermissions();
      } catch (error) {
        logger.error('Failed to sync permissions:', error);
      }
    }
    
    cache.initialize('memory');
    logger.info(`Worker ${cluster.worker.id} ready`, {
      workerId: cluster.worker.id,
      pid: process.pid,
      memory: process.memoryUsage()
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use`);
    } else {
      logger.error('Server error:', error);
    }
    process.exit(1);
  });

  const gracefulShutdown = async (signal) => {
    logger.info(`Worker ${cluster.worker.id} received ${signal}, shutting down gracefully`);
    server.close(async () => {
      logger.info(`Worker ${cluster.worker.id} HTTP server closed`);
      await closeConnection();
      logger.info(`Worker ${cluster.worker.id} shutdown complete`);
      process.exit(0);
    });
    setTimeout(() => {
      logger.error(`Worker ${cluster.worker.id} forced shutdown after timeout`);
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Master process
} else if (ENABLE_CLUSTER && cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  const useHalfWorkers = process.env.WORKER_50 === 'true';
  const explicitWorkers = Number(process.env.WORKERS);
  const workers = useHalfWorkers
    ? Math.max(1, Math.floor(numCPUs / 2))
    : Number.isInteger(explicitWorkers) && explicitWorkers > 0
      ? Math.min(explicitWorkers, numCPUs)
      : Math.max(1, numCPUs - 2); // default: leave 2 cores free

  // Run cron jobs only once (in master) to avoid duplication across workers
  if (ENABLE_CRON) {
    initCronJobs();
  }

  // Start periodic monitoring in master process only
  const db = require('./config/db');
  slowQueryLogger.startPeriodicLogging(db.sequelize, 10); // Every 10 minutes
  systemHealthLogger.startPeriodicMonitoring(10); // Every 10 minutes

  logger.info(`Starting ${workers} workers...`);
  for (let i = 0; i < workers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    logger.info('Starting a new worker...');
    cluster.fork();
  });

  const shutdownMaster = async (signal) => {
    logger.info(`Master received ${signal}, shutting down workers...`);
    for (const id in cluster.workers) {
      cluster.workers[id].disconnect();
    }

    let countdown = 30;
    const timer = setInterval(() => {
      let activeWorkers = 0;
      for (const id in cluster.workers) {
        if (cluster.workers[id].isConnected()) activeWorkers++;
      }

      if (activeWorkers === 0) {
        clearInterval(timer);
        logger.info('All workers shut down, exiting master');
        process.exit(0);
      }

      countdown--;
      if (countdown <= 0) {
        clearInterval(timer);
        logger.error('Force killing remaining workers');
        for (const id in cluster.workers) {
          if (cluster.workers[id].isConnected()) {
            cluster.workers[id].kill('SIGKILL');
          }
        }
        process.exit(1);
      }
    }, 1000);
  };

  process.on('SIGTERM', () => shutdownMaster('SIGTERM'));
  process.on('SIGINT', () => shutdownMaster('SIGINT'));

  logger.info(`Master process running with PID ${process.pid}`, {
    numCPUs,
    workers,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem()
  });

// Single process mode (development or clustering disabled)
} else {
  const server = app.listen(PORT, async () => {
    logger.info(`Server started on port ${PORT} in ${NODE_ENV} mode`);
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database, exiting...');
      process.exit(1);
    }
    
    // Sync permissions to database
    try {
      await syncAllPermissions();
    } catch (error) {
      logger.error('Failed to sync permissions:', error);
    }
    
    if (ENABLE_CRON) {
      initCronJobs();
    }
    
    cache.initialize('memory');
    
    // Start periodic monitoring in single process mode
    const db = require('./config/db');
    slowQueryLogger.startPeriodicLogging(db.sequelize, 10); // Every 10 minutes
    systemHealthLogger.startPeriodicMonitoring(10); // Every 10 minutes
    
    logger.info('Server ready', {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      memory: process.memoryUsage()
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use`);
    } else {
      logger.error('Server error:', error);
    }
    process.exit(1);
  });

  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(async () => {
      logger.info('HTTP server closed');
      await closeConnection();
      logger.info('Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}
