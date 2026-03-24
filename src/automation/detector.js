// detector.js — Shared detection utilities for login, CAPTCHA, and streaming state
const { GEMINI, CHATGPT, trySelectors } = require('./selectors');
const logger = require('../backend/logger');

/**
 * Check if the user is logged in to the given AI target.
 * @param {import('playwright').Page} page
 * @param {'gemini'|'chatgpt'} target
 * @returns {Promise<boolean>}
 */
async function isLoggedIn(page, target) {
    const selectors = target === 'chatgpt' ? CHATGPT.loggedIn : GEMINI.loggedIn;
    for (const sel of selectors) {
        try {
            const el = page.locator(sel).first();
            await el.waitFor({ state: 'visible', timeout: 2000 });
            return true;
        } catch {
            // Try next
        }
    }
    logger.warn(`Not logged in to ${target}`);
    return false;
}

/**
 * Check if a CAPTCHA is present on the page.
 * @param {import('playwright').Page} page
 * @param {'gemini'|'chatgpt'} target
 * @returns {Promise<boolean>}
 */
async function hasCaptcha(page, target) {
    const selectors = target === 'chatgpt' ? CHATGPT.captcha : GEMINI.captcha;
    for (const sel of selectors) {
        try {
            const el = page.locator(sel).first();
            await el.waitFor({ state: 'visible', timeout: 1500 });
            logger.warn(`CAPTCHA detected on ${target}`);
            return true;
        } catch {
            // Try next
        }
    }
    return false;
}

/**
 * Get the current text of the last assistant response.
 * Used to detect when streaming has stopped.
 * @param {import('playwright').Page} page
 * @param {'gemini'|'chatgpt'} target
 * @returns {Promise<string>}
 */
async function getLastResponseText(page, target) {
    const selectors = target === 'chatgpt' ? CHATGPT.responseContainer : GEMINI.responseContainer;
    for (const sel of selectors) {
        try {
            const elements = page.locator(sel);
            const count = await elements.count();
            if (count > 0) {
                return await elements.last().innerText();
            }
        } catch {
            // Try next
        }
    }
    return '';
}

/**
 * Wait until the AI response has stopped streaming.
 * Polls the last response element until its text is stable for `stableMs`.
 * @param {import('playwright').Page} page
 * @param {'gemini'|'chatgpt'} target
 * @param {number} timeout  Max total wait time in ms
 * @param {number} stableMs How long the text must be unchanged to be "done"
 * @returns {Promise<string>} Final response text
 */
async function waitForResponseComplete(page, target, timeout = 60000, stableMs = 1500) {
    const start = Date.now();
    let lastText = '';
    let stableSince = null;

    logger.info('Waiting for response to complete...');

    while (Date.now() - start < timeout) {
        await page.waitForTimeout(500);
        const text = await getLastResponseText(page, target);

        if (text && text === lastText) {
            // Text hasn't changed
            if (!stableSince) stableSince = Date.now();
            if (Date.now() - stableSince >= stableMs) {
                logger.info('Response streaming complete.', { chars: text.length });
                return text;
            }
        } else {
            // Still changing — reset stability timer
            stableSince = null;
            lastText = text;
        }
    }

    // Timeout — return whatever we have
    logger.warn('Response wait timed out, returning partial response.');
    return lastText;
}

module.exports = { isLoggedIn, hasCaptcha, waitForResponseComplete, getLastResponseText };
