// selectors.js — Centralized, resilient selectors for Gemini and ChatGPT
// Uses multiple fallback selectors for each element to survive UI updates.

/**
 * Try each selector in the array until one is found on the page.
 * Returns the first matching locator, or throws if none found.
 * @param {import('playwright').Page} page
 * @param {string[]} selectorList
 * @param {number} timeout ms to wait for each attempt
 */
async function trySelectors(page, selectorList, timeout = 3000) {
    for (const sel of selectorList) {
        try {
            const locator = page.locator(sel).first();
            await locator.waitFor({ state: 'visible', timeout });
            return locator;
        } catch {
            // Try next selector
        }
    }
    throw new Error(`None of the selectors found: ${selectorList.join(', ')}`);
}

// ───── Gemini Selectors ─────
const GEMINI = {
    // Prompt input (rich text div)
    input: [
        'div[contenteditable="true"][data-placeholder]',
        'rich-textarea div[contenteditable="true"]',
        '.ql-editor',
        'div[role="textbox"]',
    ],

    // Send button
    sendBtn: [
        'button[aria-label="Send message"]',
        'button.send-button',
        'mat-icon[aria-hidden="true"] + button',
        '[data-mat-icon-name="send"]',
        'button[aria-label*="send" i]',
    ],

    // The container that holds the latest assistant response
    responseContainer: [
        'model-response',
        '.model-response-text',
        '.response-content',
        '[data-message-author-role="model"]',
        '.markdown-container',
    ],

    // Login detection — element that only exists when logged in
    loggedIn: [
        'bard-sidenav',
        'nav[aria-label*="menu" i]',
        'button[aria-label="Your profile"]',
        '[aria-label="Google Account"]',
    ],

    // CAPTCHA detection
    captcha: [
        'iframe[src*="recaptcha"]',
        '#captcha-form',
        '.captcha-container',
    ],
};

// ───── ChatGPT Selectors ─────
const CHATGPT = {
    input: [
        '#prompt-textarea',
        'textarea[placeholder*="Message" i]',
        'div[contenteditable="true"][role="textbox"]',
        'textarea[data-id="root"]',
    ],

    sendBtn: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label*="send" i]',
        'form button[type="submit"]',
    ],

    responseContainer: [
        '[data-message-author-role="assistant"] .markdown',
        '.group\\/conversation-turn [data-message-author-role="assistant"]',
        '[class*="message"][class*="assistant"]',
        '.prose',
    ],

    loggedIn: [
        '[data-testid="user-menu-button"]',
        'button[aria-label="Open profile menu"]',
        'nav a[href="/"]',
        '#__NEXT_DATA__', // Always present when app loads
    ],

    captcha: [
        'iframe[src*="cloudflare"]',
        '#challenge-form',
        '.cf-browser-verification',
        'iframe[src*="recaptcha"]',
    ],
};

module.exports = { GEMINI, CHATGPT, trySelectors };
