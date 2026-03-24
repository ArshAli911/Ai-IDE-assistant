// chatgpt.js — Playwright automation adapter for chatgpt.com
const browser = require('./browser');
const detector = require('./detector');
const { CHATGPT, trySelectors } = require('./selectors');
const logger = require('../backend/logger');
const config = require('../../config.json');

const CHATGPT_URL = 'https://chatgpt.com';
const TARGET = 'chatgpt';

/**
 * Ensure we are on the ChatGPT chat page and logged in.
 * @param {import('playwright').Page} page
 */
async function ensureReady(page) {
    const currentUrl = page.url();

    if (!currentUrl.includes('chatgpt.com')) {
        logger.info('Navigating to ChatGPT...');
        await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2500);
    }

    // CAPTCHA check (Cloudflare)
    if (await detector.hasCaptcha(page, TARGET)) {
        throw new Error(
            'CAPTCHA_DETECTED: Please open the Playwright browser window and complete the Cloudflare verification, then retry.'
        );
    }

    // Login check
    const loggedIn = await detector.isLoggedIn(page, TARGET);
    if (!loggedIn) {
        throw new Error(
            'NOT_LOGGED_IN: Please open the Playwright browser window and log into ChatGPT, then retry your prompt.'
        );
    }
}

/**
 * Send a prompt to ChatGPT and return the completed response.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function sendPrompt(prompt) {
    const page = await browser.getPage();
    const maxRetries = config.maxRetries || 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.info(`ChatGPT sendPrompt (attempt ${attempt})`, { promptLength: prompt.length });

            await ensureReady(page);

            // ── Find the textarea ──
            const inputEl = await trySelectors(page, CHATGPT.input, 5000);
            await inputEl.click();
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Delete');
            await page.waitForTimeout(200);

            // ChatGPT uses a contenteditable div in newer versions — try fill first, then type
            try {
                await inputEl.fill(prompt);
            } catch {
                await inputEl.type(prompt, { delay: 10 });
            }

            logger.info('Prompt typed into ChatGPT input.');
            await page.waitForTimeout(300);

            // ── Click Send ──
            const sendBtn = await trySelectors(page, CHATGPT.sendBtn, 5000);
            await sendBtn.click();
            logger.info('Send button clicked on ChatGPT.');

            await page.waitForTimeout(1200);

            // ── Wait for streaming to complete ──
            const response = await detector.waitForResponseComplete(
                page,
                TARGET,
                config.responseTimeout || 60000,
                config.streamStableMs || 1500
            );

            if (!response || response.trim().length === 0) {
                throw new Error('Empty response received from ChatGPT.');
            }

            logger.info('ChatGPT response extracted.', { chars: response.length });
            return response;

        } catch (err) {
            logger.error(`ChatGPT attempt ${attempt} failed`, { error: err.message });

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
