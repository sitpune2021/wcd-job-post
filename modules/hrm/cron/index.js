/**
 * HRM Cron Module Index
 * Exports all HRM cron services and utilities
 */

const { runAttendanceCronTasks } = require('./attendanceCronService');

module.exports = {
  runAttendanceCronTasks
};
