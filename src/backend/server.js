// server.js — Express API server (internal, port 3131)
// Bridgges Electron IPC ↔ Playwright automation layer
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const cache = require('./cache');
const history = require('./history');
const logger = require('./logger');
const crawler = require('./crawler');

// Load config
const config = require('../../config.json');

// Lazy-load the correct automation adapter based on config
let automationAdapter = null;
function getAdapter() {
    if (!automationAdapter) {
        const target = config.aiTarget || 'gemini';
        logger.info(`Loading automation adapter: ${target}`);
        automationAdapter = require(`../automation/${target}`);
    }
    return automationAdapter;
}

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

// ─────────────────────────────────────────────
// GET /health — lightweight readiness probe
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ ok: true });
});

// ─────────────────────────────────────────────
// POST /crawl
// Body: { url: string, maxPages?: number }
// Returns: { pageCount, pages, combinedContent, failures }
// ─────────────────────────────────────────────
app.post('/crawl', async (req, res) => {
    const { url, maxPages } = req.body || {};

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required' });
    }

    try {
        const result = await crawler.crawlSite(url, {
            maxPages: maxPages || config.crawlMaxPages || 5,
            timeoutMs: config.crawlTimeoutMs || 10000,
            maxCharsPerPage: config.crawlMaxCharsPerPage || 5000,
        });

        logger.info('Crawl completed', {
            url: result.startUrl,
            pages: result.pageCount,
            failures: result.failures.length,
        });

        return res.json(result);
    } catch (err) {
        logger.error('/crawl failed', { error: err.message, url });
        return res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// POST /prompt
// Body: { prompt: string, codeContext?: string }
// Returns: { response: string, fromCache: boolean }
// ─────────────────────────────────────────────
app.post('/prompt', async (req, res) => {
    const { prompt, codeContext } = req.body;

    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt is required' });
    }

    // Build full prompt (append code context if provided)
    let fullPrompt = prompt.trim();
    if (codeContext && typeof codeContext === 'string' && codeContext.trim()) {
        fullPrompt += `\n\n\`\`\`\n${codeContext.trim()}\n\`\`\``;
    }

    // ── Check cache ──
    const cached = cache.get(fullPrompt);
    if (cached) {
        history.append('user', fullPrompt);
        history.append('assistant', cached);
        return res.json({ response: cached, fromCache: true });
    }

    // ── Run automation ──
    try {
        // Enforce request delay to avoid rate limits
        if (config.requestDelay > 0) {
            await new Promise(r => setTimeout(r, config.requestDelay));
        }

        const adapter = getAdapter();
        const response = await adapter.sendPrompt(fullPrompt);

        // Store in cache and history
        cache.set(fullPrompt, response);
        history.append('user', fullPrompt);
        history.append('assistant', response);

        return res.json({ response, fromCache: false });
    } catch (err) {
        logger.error('/prompt failed', { error: err.message });
        return res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────
// GET /history — return full conversation history
// ─────────────────────────────────────────────
app.get('/history', (req, res) => {
    res.json(history.getAll());
});

// ─────────────────────────────────────────────
// DELETE /history — clear history
// ─────────────────────────────────────────────
app.delete('/history', (req, res) => {
    history.clear();
    res.json({ ok: true });
});

// ─────────────────────────────────────────────
// GET /config — return current config
// PUT /config — update specific config keys
// ─────────────────────────────────────────────
app.get('/config', (req, res) => {
    res.json(config);
});

app.put('/config', (req, res) => {
    const fs = require('fs');
    const CONFIG_FILE = path.join(__dirname, '../../config.json');
    try {
        Object.assign(config, req.body);
        // Reset adapter so it reloads on next call
        automationAdapter = null;
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        logger.info('Config updated', req.body);
        res.json({ ok: true, config });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
const PORT = config.serverPort || 3131;
app.listen(PORT, '127.0.0.1', () => {
    logger.info(`API server running on http://127.0.0.1:${PORT}`);
    if (typeof process.send === 'function') {
        process.send({ type: 'server-ready', port: PORT });
    }
});

module.exports = app;
