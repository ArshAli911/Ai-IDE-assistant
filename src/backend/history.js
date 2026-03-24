// history.js — Append-only conversation history stored in data/history.json
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const HISTORY_FILE = path.join(__dirname, '../../data/history.json');
const DATA_DIR = path.join(__dirname, '../../data');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load the full history array from disk.
 * @returns {Array<{role: string, content: string, timestamp: string}>}
 */
function load() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) {
        logger.warn('History load error', { error: e.message });
    }
    return [];
}

/**
 * Save the full history array to disk.
 */
function save(history) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
        logger.error('History save error', { error: e.message });
    }
}

/**
 * Append a new message entry.
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
function append(role, content) {
    const history = load();
    history.push({ role, content, timestamp: new Date().toISOString() });
    save(history);
}

/**
 * Return the full history.
 */
function getAll() {
    return load();
}

/**
 * Clear the history file.
 */
function clear() {
    save([]);
    logger.info('History cleared');
}

module.exports = { append, getAll, clear };
