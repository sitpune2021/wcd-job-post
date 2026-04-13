/**
 * System Health Logger
 * 
 * Monitors and logs server health metrics to file
 * Enable/disable via ENABLE_SYSTEM_HEALTH_LOG in .env
 */

const os = require('os');
const { exec } = require('child_process');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

// Simple enable/disable flag
const ENABLE_SYSTEM_HEALTH_LOG = process.env.ENABLE_SYSTEM_HEALTH_LOG === 'true';

// Fixed thresholds
const DISK_WARNING_THRESHOLD = 80;
const DISK_CRITICAL_THRESHOLD = 90;
const RAM_WARNING_THRESHOLD = 80;
const RAM_CRITICAL_THRESHOLD = 90;
const CPU_WARNING_THRESHOLD = 85;
const CPU_CRITICAL_THRESHOLD = 95;

// Log file path
const HEALTH_LOG_FILE = path.join(__dirname, '../logs/system-health.log');

// Ensure logs directory exists
const logsDir = path.dirname(HEALTH_LOG_FILE);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Get RAM usage percentage
 */
const getRamUsage = () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const usagePercent = Math.round((usedMem / totalMem) * 100);

  return {
    total: Math.round(totalMem / (1024 * 1024 * 1024)), // GB
    used: Math.round(usedMem / (1024 * 1024 * 1024)), // GB
    free: Math.round(freeMem / (1024 * 1024 * 1024)), // GB
    usagePercent
  };
};

/**
 * Sample CPU usage cross-platform (works on Windows where loadavg is zeros)
 */
const getCpuUsage = () => {
  return new Promise((resolve) => {
    const start = os.cpus();
    setTimeout(() => {
      const end = os.cpus();
      let idleDiff = 0;
      let totalDiff = 0;

      for (let i = 0; i < start.length; i++) {
        const startTimes = start[i].times;
        const endTimes = end[i].times;
        const idle = endTimes.idle - startTimes.idle;
        const total = (endTimes.user - startTimes.user) + (endTimes.nice - startTimes.nice) + (endTimes.sys - startTimes.sys) + (endTimes.irq - startTimes.irq) + idle;
        idleDiff += idle;
        totalDiff += total;
      }

      const usagePercent = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
      const loadAvg = os.loadavg();

      resolve({
        cores: os.cpus().length,
        loadAvg1min: loadAvg[0].toFixed(2),
        loadAvg5min: loadAvg[1].toFixed(2),
        loadAvg15min: loadAvg[2].toFixed(2),
        usagePercent: Math.min(usagePercent, 100)
      });
    }, 250);
  });
};

/**
 * Get process memory usage
 */
const getProcessMemory = () => {
  const memUsage = process.memoryUsage();
  
  return {
    rss: Math.round(memUsage.rss / (1024 * 1024)), // MB
    heapTotal: Math.round(memUsage.heapTotal / (1024 * 1024)), // MB
    heapUsed: Math.round(memUsage.heapUsed / (1024 * 1024)), // MB
    external: Math.round(memUsage.external / (1024 * 1024)), // MB
    heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
  };
};

/**
 * Get disk usage percentage (async, Windows + Linux)
 */
const getDiskUsage = () => {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Use PowerShell for cross-drive support; default to system drive
      const drive = process.env.SYSTEMDRIVE || 'C:';
      const cmd = `powershell -NoProfile -Command "Get-PSDrive -Name ${drive.replace(':','')} | Select-Object @{Name='Used';Expression={[math]::Round((($_.Used)/1GB),2)}},@{Name='Free';Expression={[math]::Round((($_.Free)/1GB),2)}},@{Name='Total';Expression={[math]::Round((($_.Used + $_.Free)/1GB),2)}},@{Name='UsagePercent';Expression={[math]::Round((($_.Used)/($_.Used + $_.Free))*100,0)}} | ConvertTo-Json"`;
      exec(cmd, (err, stdout) => {
        if (err) {
          logger.error('Error getting disk usage (Windows)', { error: err.message });
          return resolve({ total: null, used: null, available: null, usagePercent: 0 });
        }
        try {
          const data = JSON.parse(stdout.trim());
          resolve({
            total: data?.Total || null,
            used: data?.Used || null,
            available: data?.Free || null,
            usagePercent: data?.UsagePercent != null ? Number(data.UsagePercent) : 0
          });
        } catch (parseError) {
          logger.error('Error parsing disk usage (Windows)', { error: parseError.message });
          resolve({ total: null, used: null, available: null, usagePercent: 0 });
        }
      });
      return;
    }

    // Linux/Unix
    exec('df -P / | tail -1', (err, stdout) => {
      if (err) {
        logger.error('Error getting disk usage', { error: err.message });
        return resolve({ total: null, used: null, available: null, usagePercent: 0 });
      }

      try {
        // Parse df output: Filesystem Size Used Avail Use% Mounted
        const parts = stdout.trim().split(/\s+/);
        const usagePercent = parseInt(parts[4].replace('%', ''));
        const total = Math.round(Number(parts[1]) / (1024 * 1024) * 100) / 100; // GB
        const used = Math.round(Number(parts[2]) / (1024 * 1024) * 100) / 100;  // GB
        const available = Math.round(Number(parts[3]) / (1024 * 1024) * 100) / 100; // GB

        resolve({
          total,
          used,
          available,
          usagePercent
        });
      } catch (parseError) {
        logger.error('Error parsing disk usage', { error: parseError.message });
        resolve({ total: null, used: null, available: null, usagePercent: 0 });
      }
    });
  });
};

/**
 * Get system uptime
 */
const getUptime = () => {
  const uptimeSeconds = os.uptime();
  const processUptimeSeconds = process.uptime();

  const formatUptime = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  return {
    system: formatUptime(uptimeSeconds),
    process: formatUptime(processUptimeSeconds),
    systemSeconds: Math.round(uptimeSeconds),
    processSeconds: Math.round(processUptimeSeconds)
  };
};

/**
 * Determine health status based on metrics
 */
const determineStatus = (disk, ram, cpu) => {
  if (
    disk.usagePercent >= DISK_CRITICAL_THRESHOLD ||
    ram.usagePercent >= RAM_CRITICAL_THRESHOLD ||
    cpu.usagePercent >= CPU_CRITICAL_THRESHOLD
  ) {
    return 'CRITICAL';
  }

  if (
    disk.usagePercent >= DISK_WARNING_THRESHOLD ||
    ram.usagePercent >= RAM_WARNING_THRESHOLD ||
    cpu.usagePercent >= CPU_WARNING_THRESHOLD
  ) {
    return 'WARNING';
  }

  return 'OK';
};

/**
 * Collect all system health metrics
 */
const collectHealthMetrics = async () => {
  try {
    const ram = getRamUsage();
    const cpu = await getCpuUsage();
    const disk = await getDiskUsage();
    const processMemory = getProcessMemory();
    const uptime = getUptime();
    const status = determineStatus(disk, ram, cpu);

    return {
      timestamp: new Date().toISOString(),
      status,
      disk,
      ram,
      cpu,
      processMemory,
      uptime,
      platform: os.platform(),
      hostname: os.hostname(),
      nodeVersion: process.version
    };
  } catch (error) {
    logger.error('Error collecting health metrics', { error: error.message });
    throw error;
  }
};

/**
 * Log health metrics to file only
 */
const logHealthMetrics = async () => {
  if (!ENABLE_SYSTEM_HEALTH_LOG) return null;

  try {
    const metrics = await collectHealthMetrics();

    // Simple log line with status and suggestions
    let logLine = `[${metrics.timestamp}] [${metrics.status}] Disk: ${metrics.disk.usagePercent}% | RAM: ${metrics.ram.usagePercent}% | CPU: ${metrics.cpu.usagePercent}% | Uptime: ${metrics.uptime.system}\n`;
    
    // Add suggestions for WARNING/CRITICAL
    if (metrics.status === 'WARNING') {
      logLine += `Suggestion: Monitor resource usage closely. Consider cleanup or upgrade if trend continues.\n`;
    } else if (metrics.status === 'CRITICAL') {
      logLine += ` CRITICAL: Immediate action required! Free up resources or upgrade server.\n`;
    }
    
    fs.appendFileSync(HEALTH_LOG_FILE, logLine, 'utf8');

    return metrics;
  } catch (error) {
    return null;
  }
};

/**
 * Start periodic health monitoring
 * @param {number} intervalMinutes - how often to log, in minutes (default 10 minutes)
 * To run every 30 seconds, call startPeriodicMonitoring(0.5)
 * To run every 10 seconds, call startPeriodicMonitoring(10 / 60)
 */
const startPeriodicMonitoring = (intervalMinutes = 10) => {
  if (!ENABLE_SYSTEM_HEALTH_LOG) return;

  const intervalMs = intervalMinutes * 60 * 1000;

  // Log immediately on start
  logHealthMetrics();

  // Then log periodically
  setInterval(() => {
    logHealthMetrics();
  }, intervalMs);
};

/**
 * Get current health status (for API endpoints)
 */
const getCurrentHealth = async () => {
  return await collectHealthMetrics();
};

module.exports = {
  collectHealthMetrics,
  logHealthMetrics,
  startPeriodicMonitoring,
  getCurrentHealth,
  getRamUsage,
  getCpuUsage,
  getDiskUsage,
  getProcessMemory,
  getUptime
};
