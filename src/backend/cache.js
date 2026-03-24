// cache.js — SHA-256 keyed prompt/response cache stored in data/cache.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const CACHE_FILE = path.join(__dirname, '../../data/cache.json');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load the cache from disk. Returns an empty object if file doesn't exist.
 */
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const raw = fs.readFileSync(CACHE_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        logger.warn('Cache load error, starting fresh.', { error: e.message });
    }
    return {};
}

/**
 * Save the cache object to disk.
 */
function saveCache(cache) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch (e) {
        logger.error('Cache save error', { error: e.message });
    }
}

/**
 * Hash a prompt string to a cache key.
 * @param {string} prompt
 */
function hashPrompt(prompt) {
    return crypto.createHash('sha256').update(prompt.trim().toLowerCase()).digest('hex');
}

/**
 * Check if a prompt is cached. Returns response string or null.
 * @param {string} prompt
 */
function get(prompt) {
    const cache = loadCache();
    const key = hashPrompt(prompt);
    if (cache[key]) {
        logger.info('Cache HIT', { key: key.slice(0, 12) });
        return cache[key].response;
    }
    return null;
}

/**
 * Store a prompt-response pair in the cache.
 * @param {string} prompt
 * @param {string} response
 */
function set(prompt, response) {
    const cache = loadCache();
    const key = hashPrompt(prompt);
    cache[key] = {
        prompt,
        response,
        cachedAt: new Date().toISOString(),
    };
    saveCache(cache);
    logger.info('Cache SET', { key: key.slice(0, 12) });
}

/**
 * Clear all cached entries.
 */
function clear() {
    saveCache({});
    logger.info('Cache cleared');
}

module.exports = { get, set, clear };
