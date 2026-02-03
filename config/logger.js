const winston = require('winston');
const { createLogger, format, transports } = winston;
const { combine, timestamp, printf, colorize } = format;
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Define log format
const logFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let metaStr = '';
  if (Object.keys(metadata).length > 0) {
    metaStr = JSON.stringify(metadata);
  }
  return `${timestamp} [${level}]: ${message} ${metaStr}`;
});

// Single flat log file (no rotation)
const fileTransport = new transports.File({
  filename: path.join(logDir, 'application.log'),
  level: process.env.LOG_LEVEL || 'info',
  maxsize: 50 * 1024 * 1024, // 50MB safety cap
});

// Create console transport
const consoleTransport = new transports.Console({
  format: combine(
    colorize(),
    timestamp(),
    logFormat
  ),
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
});

// Create logger
const logger = createLogger({
  format: combine(
    timestamp(),
    logFormat
  ),
  transports: [
    fileTransport,
    consoleTransport
  ],
  exitOnError: false
});

// Create a stream object for Morgan
logger.stream = {
  write: (message) => logger.info(message.trim())
};

module.exports = logger;
