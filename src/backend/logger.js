// logger.js — File-based logger for all automation and backend events
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../data/logs');
const LOG_FILE = path.join(LOG_DIR, 'automation.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Write a log entry to file and stdout.
 * @param {'INFO'|'WARN'|'ERROR'} level
 * @param {string} message
 * @param {any} [data] - optional extra data to JSON-stringify
 */
function log(level, message, data) {
  const timestamp = new Date().toISOString();
  const extra = data ? ` | ${JSON.stringify(data)}` : '';
  const line = `[${timestamp}] [${level}] ${message}${extra}\n`;

  // Write to file (append)
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    console.error('Logger write error:', e.message);
  }

  // Also print to terminal
  const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[36m';
  console.log(`${color}${line.trim()}\x1b[0m`);
}

module.exports = {
  info:  (msg, data) => log('INFO',  msg, data),
  warn:  (msg, data) => log('WARN',  msg, data),
  error: (msg, data) => log('ERROR', msg, data),
};
