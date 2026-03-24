const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function normalizeUrl(input, baseUrl) {
    const url = new URL(input, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`Unsupported protocol: ${url.protocol}`);
    }
    url.hash = '';
    return url.toString();
}

function decodeEntities(text) {
    const named = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
    };

    return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === '#') {
            const isHex = entity[1]?.toLowerCase() === 'x';
            const raw = isHex ? entity.slice(2) : entity.slice(1);
            const codePoint = parseInt(raw, isHex ? 16 : 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
        }
        return named[entity.toLowerCase()] || match;
    });
}

function stripHtml(html) {
    return decodeEntities(
        html
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
            .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

function getTitle(html) {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? decodeEntities(match[1].replace(/\s+/g, ' ').trim()) : '';
}

function getMetaDescription(html) {
    const match = html.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
    );
    return match ? decodeEntities(match[1].trim()) : '';
}

function extractLinks(html, pageUrl, origin) {
    const links = [];
    const seen = new Set();
    const hrefRegex = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi;
    let match;

    while ((match = hrefRegex.exec(html)) !== null) {
        const href = match[1] || match[2] || match[3] || '';
        if (!href || href.startsWith('#')) continue;
        if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;

        try {
            const normalized = normalizeUrl(href, pageUrl);
            if (!normalized.startsWith(origin)) continue;
            if (seen.has(normalized)) continue;
            seen.add(normalized);
            links.push(normalized);
        } catch {
            // Ignore malformed links.
        }
    }

    return links;
}

async function fetchHtml(url, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'user-agent': DEFAULT_USER_AGENT,
                accept: 'text/html,application/xhtml+xml',
            },
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('text/html')) {
            throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
        }

        return {
            finalUrl: normalizeUrl(res.url),
            html: await res.text(),
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

function buildPageMarkdown(page, index) {
    const lines = [
        `## ${index}. ${page.title || page.url}`,
        '',
        `URL: ${page.url}`,
    ];

    if (page.description) {
        lines.push(`Description: ${page.description}`);
    }

    lines.push('', page.content || '(No readable text extracted.)');
    return lines.join('\n');
}

async function crawlSite(startUrl, options = {}) {
    const maxPages = Math.min(Math.max(Number(options.maxPages) || 5, 1), 20);
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 10000, 1000), 30000);
    const maxCharsPerPage = Math.min(Math.max(Number(options.maxCharsPerPage) || 5000, 500), 20000);

    let normalizedStartUrl;
    try {
        normalizedStartUrl = normalizeUrl(startUrl);
    } catch (err) {
        throw new Error(`Invalid URL: ${err.message}`);
    }

    const origin = new URL(normalizedStartUrl).origin;
    const queue = [normalizedStartUrl];
    const visited = new Set();
    const pages = [];
    const failures = [];

    while (queue.length > 0 && pages.length < maxPages) {
        const currentUrl = queue.shift();
        if (!currentUrl || visited.has(currentUrl)) continue;
        visited.add(currentUrl);

        try {
            const { finalUrl, html } = await fetchHtml(currentUrl, timeoutMs);
            if (visited.has(finalUrl) && finalUrl !== currentUrl) continue;
            visited.add(finalUrl);

            if (new URL(finalUrl).origin !== origin) {
                continue;
            }

            const title = getTitle(html);
            const description = getMetaDescription(html);
            const content = stripHtml(html).slice(0, maxCharsPerPage);
            const links = extractLinks(html, finalUrl, origin);

            pages.push({
                url: finalUrl,
                title,
                description,
                content,
                links,
            });

            for (const link of links) {
                if (!visited.has(link) && !queue.includes(link) && queue.length + pages.length < maxPages * 3) {
                    queue.push(link);
                }
            }
        } catch (err) {
            failures.push({
                url: currentUrl,
                error: err.message,
            });
        }
    }

    const combinedContent = [
        `# Crawl Report`,
        '',
        `Start URL: ${normalizedStartUrl}`,
        `Origin: ${origin}`,
        `Pages Crawled: ${pages.length}`,
        failures.length ? `Failures: ${failures.length}` : 'Failures: 0',
        '',
        `Use this tab as prompt context in the editor. The chat box will include the active editor content automatically.`,
        '',
        ...pages.map((page, index) => buildPageMarkdown(page, index + 1)),
    ].join('\n');

    return {
        startUrl: normalizedStartUrl,
        origin,
        pageCount: pages.length,
        failures,
        pages,
        combinedContent,
    };
}

module.exports = { crawlSite };
