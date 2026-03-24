// browser.js — Playwright persistent browser context manager
// Saves session/cookies to data/session/ so login persists across restarts.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const logger = require('../backend/logger');

const SESSION_DIR = path.join(__dirname, '../../data/session');
const config = require('../../config.json');

// Ensure session directory exists
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

let _context = null; // Playwright BrowserContext singleton
let _page = null; // Main page singleton

/**
 * Launch (or reuse) a persistent Playwright browser context.
 * The context is saved to SESSION_DIR so cookies survive restarts.
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function getContext() {
    if (_context) return _context;

    logger.info('Launching Playwright browser (persistent context)...');
    _context = await chromium.launchPersistentContext(SESSION_DIR, {
        headless: config.headless === true,
        viewport: { width: 1280, height: 800 },
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled', // hide automation flag
            '--disable-infobars',
        ],
        ignoreHTTPSErrors: true,
    });

    // Handle unexpected browser close
    _context.on('close', () => {
        logger.warn('Browser context closed unexpectedly. Will relaunch on next request.');
        _context = null;
        _page = null;
    });

    logger.info('Browser launched successfully.');
    return _context;
}

/**
 * Get the main page, creating one if needed.
 * @returns {Promise<import('playwright').Page>}
 */
async function getPage() {
    const context = await getContext();

    // Reuse existing page if still open
    if (_page && !_page.isClosed()) return _page;

    const pages = context.pages();
    _page = pages.length > 0 ? pages[0] : await context.newPage();

    // Stealth: remove webdriver property
    await _page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    logger.info('Page ready.');
    return _page;
}

/**
 * Close the browser context (call on app exit).
 */
async function close() {
    if (_context) {
        await _context.close();
        _context = null;
        _page = null;
        logger.info('Browser closed.');
    }
}

module.exports = { getPage, getContext, close };
