// gemini.js — Playwright automation adapter for gemini.google.com
const browser = require('./browser');
const detector = require('./detector');
const { GEMINI, trySelectors } = require('./selectors');
const logger = require('../backend/logger');
const config = require('../../config.json');

const GEMINI_URL = 'https://gemini.google.com';
const TARGET = 'gemini';

let _navigated = false; // Track if we've already loaded the page this session

/**
 * Ensure we are on the Gemini chat page and logged in.
 * @param {import('playwright').Page} page
 */
async function ensureReady(page) {
    const currentUrl = page.url();

    // Navigate if not on Gemini
    if (!currentUrl.includes('gemini.google.com')) {
        logger.info('Navigating to Gemini...');
        await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        _navigated = true;
    }

    // Check for CAPTCHA
    if (await detector.hasCaptcha(page, TARGET)) {
        throw new Error(
            'CAPTCHA_DETECTED: Please open the Playwright browser window and solve the CAPTCHA manually, then retry.'
        );
    }

    // Check for login
    const loggedIn = await detector.isLoggedIn(page, TARGET);
    if (!loggedIn) {
        throw new Error(
            'NOT_LOGGED_IN: Please open the Playwright browser window (it should be visible on your taskbar) and log into Gemini, then retry your prompt.'
        );
    }
}

/**
 * Type a prompt into Gemini and return the completed response.
 * Implements retries as configured.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function sendPrompt(prompt) {
    const page = await browser.getPage();
    const maxRetries = config.maxRetries || 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.info(`Gemini sendPrompt (attempt ${attempt})`, { promptLength: prompt.length });

            await ensureReady(page);

            // ── Find and clear the input ──
            const inputEl = await trySelectors(page, GEMINI.input, 5000);
            await inputEl.click();
            // Select all and clear
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Delete');
            await page.waitForTimeout(200);

            // ── Type the prompt ──
            await inputEl.fill('');
            await inputEl.type(prompt, { delay: 15 }); // Small delay looks more human
            logger.info('Prompt typed into Gemini input.');

            await page.waitForTimeout(300);

            // ── Click Send ──
            const sendBtn = await trySelectors(page, GEMINI.sendBtn, 5000);
            await sendBtn.click();
            logger.info('Send button clicked on Gemini.');

            // Small wait for the response to start appearing
            await page.waitForTimeout(1000);

            // ── Wait for streaming to complete ──
            const response = await detector.waitForResponseComplete(
                page,
                TARGET,
                config.responseTimeout || 60000,
                config.streamStableMs || 1500
            );

            if (!response || response.trim().length === 0) {
                throw new Error('Empty response received from Gemini.');
            }

            logger.info('Gemini response extracted.', { chars: response.length });
            return response;

        } catch (err) {
            logger.error(`Gemini attempt ${attempt} failed`, { error: err.message });

            // Don't retry on login/captcha errors
            if (err.message.startsWith('CAPTCHA_DETECTED') || err.message.startsWith('NOT_LOGGED_IN')) {
                throw err;
            }

            if (attempt === maxRetries) throw err;
            logger.info(`Retrying in ${config.requestDelay}ms...`);
            await page.waitForTimeout(config.requestDelay || 1500);
        }
    }
}

module.exports = { sendPrompt };
