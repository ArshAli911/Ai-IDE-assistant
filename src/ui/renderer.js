// renderer.js — Full UI logic: chat, file explorer, code editor, and terminal
// Communicates with main process via window.api (defined in preload.js)

'use strict';

// ═══════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════
const api = window.api;
const $ = id => document.getElementById(id);

const chatOutput = $('chat-output');
const promptInput = $('prompt-input');
const crawlBtn = $('crawl-btn');
const sendBtn = $('send-btn');
const typingIndicator = $('typing-indicator');
const historyList = $('history-list');
const clearHistoryBtn = $('clear-history-btn');

const activityBtns = document.querySelectorAll('.ab-btn[data-panel]');
const panelChat = $('panel-chat');
const panelExplorer = $('panel-explorer');
const abSettings = $('ab-settings');

const openFolderBtn = $('open-folder-btn');
const thisPcBtn = $('this-pc-btn');
const newFileBtn = $('new-file-btn');
const newFolderBtn = $('new-folder-btn');
const fileTree = $('file-tree');

const editorTabBar = $('editor-tab-bar');
const editorTabNew = $('editor-tab-new');
const editorTextarea = $('editor-textarea');
const editorLint = $('editor-lint');
const editorActiveFile = $('editor-active-file');
const fixCodeBtn = $('fix-code-btn');
const explainBtn = $('explain-btn');
const saveFileBtn = $('save-file-btn');

const sbTargetLabel = $('sb-target-label');
const sbFolder = $('sb-folder');
const sbStatusText = $('sb-status-text');
const sbSpinner = $('sb-spinner');

const contextMenu = $('context-menu');
const modalOverlay = $('modal-overlay');
const modalTitle = $('modal-title');
const modalInput = $('modal-input');
const modalConfirm = $('modal-confirm');
const modalCancel = $('modal-cancel');

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
let currentConfig = {};
let openFolderPath = null;
let currentCtxTarget = null;
let modalResolver = null;
let modalIsConfirm = false;
let isSending = false;
let isCrawling = false;

// Editor tabs: [{ id, name, path, content, modified }]
let editorTabs = [];
let activeTabId = null;
let scratchCounter = 1;

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
async function init() {
    try {
        currentConfig = await api.getConfig();
        sbTargetLabel.textContent = currentConfig.aiTarget || 'gemini';
    } catch (e) {
        // Server may still be starting — retry once
        setTimeout(async () => {
            try { currentConfig = await api.getConfig(); } catch { }
        }, 2000);
    }

    await loadHistory();
    setupWindowControls();
    setupActivityBar();
    setupChatInput();
    setupEditorPanel();
    setupContextMenu();
    setupModal();
    setupStatusBar();
    setupTerminal();
}

// ═══════════════════════════════════════════════
// WINDOW CONTROLS
// ═══════════════════════════════════════════════
function setupWindowControls() {
    $('wc-min').onclick = () => api.minimize();
    $('wc-max').onclick = () => api.maximize();
    $('wc-close').onclick = () => api.close();
}

// ═══════════════════════════════════════════════
// ACTIVITY BAR — switch between Chat, Explorer, Terminal
// ═══════════════════════════════════════════════
function setupActivityBar() {
    activityBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const panel = btn.dataset.panel;

            // Terminal button is a toggle, not a sidebar switcher
            if (panel === 'terminal') {
                toggleTerminalPanel();
                return;
            }

            activityBtns.forEach(b => {
                if (b.dataset.panel !== 'terminal') b.classList.remove('active');
            });
            btn.classList.add('active');

            panelChat.classList.toggle('hidden', panel !== 'chat');
            panelExplorer.classList.toggle('hidden', panel !== 'explorer');

            if (panel === 'explorer' && !openFolderPath) {
                showSystemRoots();
            }
        });
    });

    abSettings.addEventListener('click', showSettingsPanel);
}

// ═══════════════════════════════════════════════
// SETTINGS (inline in chat output)
// ═══════════════════════════════════════════════
async function showSettingsPanel() {
    const cfg = await api.getConfig();
    const html = `
    <div class="msg-header">
      <div class="msg-avatar user">⚙️</div>
      <span class="msg-role user">Settings</span>
    </div>
    <div class="msg-body assistant" style="padding:16px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr><td style="padding:6px 0;color:var(--text-muted);width:140px">AI Target</td>
            <td><select id="cfg-target" style="background:var(--bg-active);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:12px">
              <option value="gemini" ${cfg.aiTarget === 'gemini' ? 'selected' : ''}>Gemini</option>
              <option value="chatgpt" ${cfg.aiTarget === 'chatgpt' ? 'selected' : ''}>ChatGPT</option>
            </select></td></tr>
        <tr><td style="padding:6px 0;color:var(--text-muted)">Request Delay (ms)</td>
            <td><input id="cfg-delay" type="number" value="${cfg.requestDelay}" min="0" max="10000" step="100" style="background:var(--bg-active);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:3px 8px;width:100px;font-size:12px" /></td></tr>
        <tr><td style="padding:6px 0;color:var(--text-muted)">Response Timeout (ms)</td>
            <td><input id="cfg-timeout" type="number" value="${cfg.responseTimeout}" min="10000" step="5000" style="background:var(--bg-active);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:3px 8px;width:100px;font-size:12px" /></td></tr>
        <tr><td style="padding:6px 0;color:var(--text-muted)">Max Retries</td>
            <td><input id="cfg-retries" type="number" value="${cfg.maxRetries}" min="1" max="10" style="background:var(--bg-active);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:3px 8px;width:100px;font-size:12px" /></td></tr>
        <tr><td style="padding:6px 0;color:var(--text-muted)">Headless Browser</td>
            <td><input id="cfg-headless" type="checkbox" ${cfg.headless ? 'checked' : ''} style="width:16px;height:16px" /></td></tr>
      </table>
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="ed-btn primary" id="save-settings-btn">💾 Save Settings</button>
      </div>
    </div>
  `;
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.innerHTML = html;
    chatOutput.appendChild(div);
    chatOutput.scrollTop = chatOutput.scrollHeight;

    $('save-settings-btn').onclick = async () => {
        const updates = {
            aiTarget: $('cfg-target').value,
            requestDelay: parseInt($('cfg-delay').value),
            responseTimeout: parseInt($('cfg-timeout').value),
            maxRetries: parseInt($('cfg-retries').value),
            headless: $('cfg-headless').checked,
        };
        try {
            await api.updateConfig(updates);
            currentConfig = { ...currentConfig, ...updates };
            sbTargetLabel.textContent = updates.aiTarget;
            appendSystemMessage('✅ Settings saved! Some changes take effect on next prompt.');
        } catch (e) {
            appendSystemMessage('❌ Failed to save settings: ' + e.message, 'error');
        }
    };
}

// ═══════════════════════════════════════════════
// CHAT — Send prompt and display response
// ═══════════════════════════════════════════════
function setupChatInput() {
    promptInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
    });
    crawlBtn.addEventListener('click', crawlWebsite);
    sendBtn.addEventListener('click', sendMessage);
    clearHistoryBtn.addEventListener('click', clearHistory);
}

async function sendMessage() {
    if (isSending) return;
    const text = promptInput.value.trim();
    if (!text) return;

    promptInput.value = '';
    promptInput.style.height = 'auto';

    const codeCtx = editorTextarea.value.trim() || null;

    isSending = true;
    setStatus('Sending…', true);
    sendBtn.disabled = true;

    appendMessage('user', text);

    typingIndicator.classList.add('visible');
    chatOutput.scrollTop = chatOutput.scrollHeight;

    try {
        const result = await api.sendPrompt(text, codeCtx);
        typingIndicator.classList.remove('visible');
        appendMessage('assistant', result.response, result.fromCache);
        setStatus('Ready');
    } catch (err) {
        typingIndicator.classList.remove('visible');
        const userMsg = formatError(err.message);
        appendMessage('assistant', userMsg, false, true);
        setStatus('Error', false);
    } finally {
        isSending = false;
        sendBtn.disabled = false;
        await loadHistory();
    }
}

function formatError(msg) {
    if (msg.startsWith('CAPTCHA_DETECTED')) {
        return '⚠️ **CAPTCHA Detected**\n\nA CAPTCHA appeared in the AI browser window. Please solve it there and then retry your prompt.';
    }
    if (msg.startsWith('NOT_LOGGED_IN')) {
        return '⚠️ **Not Logged In**\n\nA browser window has opened — please log into ' + (currentConfig.aiTarget || 'Gemini') + ' there. Your session will be saved for future launches.';
    }
    return '❌ Error: ' + msg;
}

function appendMessage(role, content, fromCache = false, isError = false) {
    const div = document.createElement('div');
    div.className = 'chat-message';

    const avatar = role === 'user' ? '👤' : '🤖';
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cacheBadge = fromCache ? '<span class="badge-cached">CACHED</span>' : '';
    const bodyClass = isError ? 'error' : role + (fromCache ? ' cached' : '');

    div.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar ${role}">${avatar}</div>
      <span class="msg-role ${role}">${role}</span>
      ${cacheBadge}
      <span class="msg-time">${now}</span>
    </div>
    <div class="msg-body ${bodyClass}">${formatMarkdown(content)}</div>
  `;

    div.querySelectorAll('pre').forEach(pre => {
        const btn = document.createElement('button');
        btn.className = 'copy-code-btn';
        btn.textContent = 'Copy';
        btn.onclick = () => {
            const code = pre.querySelector('code')?.innerText || pre.innerText;
            navigator.clipboard.writeText(code);
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy', 2000);
        };
        pre.appendChild(btn);
    });

    chatOutput.appendChild(div);
    chatOutput.scrollTop = chatOutput.scrollHeight;

    if (window.Prism) Prism.highlightAllUnder(div);
}

function appendSystemMessage(text, type = 'info') {
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.innerHTML = `<div class="msg-body ${type === 'error' ? 'error' : 'assistant'}" style="font-size:12px;opacity:0.8">${text}</div>`;
    chatOutput.appendChild(div);
    chatOutput.scrollTop = chatOutput.scrollHeight;
}

async function crawlWebsite() {
    if (isCrawling) return;

    const url = await showModal('Crawl website URL:', 'https://example.com');
    if (!url) return;

    isCrawling = true;
    crawlBtn.disabled = true;
    setStatus('Crawling site...', true);
    appendSystemMessage('Crawling website content into a new editor tab...');

    try {
        const result = await api.crawlSite(url, currentConfig.crawlMaxPages || 5);
        const host = new URL(result.startUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
        const tabName = `crawl-${host}.md`;

        openGeneratedTab(tabName, result.combinedContent);

        const failureNote = result.failures.length > 0
            ? ` ${result.failures.length} page(s) failed or were skipped.`
            : '';

        appendSystemMessage(
            `Crawl complete. Loaded ${result.pageCount} page(s) from ${result.origin} into the editor.${failureNote}`
        );
        setStatus('Ready');
    } catch (e) {
        appendSystemMessage('Crawl failed: ' + e.message, 'error');
        setStatus('Error');
    } finally {
        isCrawling = false;
        crawlBtn.disabled = false;
    }
}

function formatMarkdown(text) {
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const cls = lang ? ` class="language-${lang}"` : '';
        return `<pre><code${cls}>${code.trim()}</code></pre>`;
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^[ \t]*[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    html = html
        .split(/\n\n+/)
        .map(block => block.trim())
        .filter(Boolean)
        .map(block => {
            if (block.startsWith('<pre>') || block.startsWith('<ul>') || block.startsWith('<ol>')) return block;
            return `<p>${block.replace(/\n/g, '<br/>')}</p>`;
        })
        .join('\n');

    return html;
}

// ── Conversation History Sidebar ──
async function loadHistory() {
    try {
        const entries = await api.getHistory();
        if (!entries || entries.length === 0) {
            historyList.innerHTML = '<div class="tree-empty">No conversation history yet.<br/>Send a prompt to get started.</div>';
            return;
        }
        historyList.innerHTML = '';
        entries.slice().reverse().forEach(entry => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
        <div class="hi-role ${entry.role}">${entry.role}</div>
        <div class="hi-content">${entry.content.replace(/</g, '&lt;').slice(0, 80)}</div>
      `;
            historyList.appendChild(item);
        });
    } catch { /* server not ready yet */ }
}

async function clearHistory() {
    const ok = await showModal('Clear all conversation history?', '', true);
    if (!ok) return;
    await api.clearHistory();
    chatOutput.innerHTML = '';
    appendSystemMessage('🗑 History cleared.');
    await loadHistory();
}

// ═══════════════════════════════════════════════
// FILE EXPLORER
// ═══════════════════════════════════════════════
let treeData = [];

openFolderBtn.addEventListener('click', async () => {
    const folderPath = await api.openFolder();
    if (!folderPath) return;
    await setOpenFolder(folderPath);
});
thisPcBtn.addEventListener('click', showSystemRoots);

newFileBtn.addEventListener('click', () => createNewInFolder('file', openFolderPath));
newFolderBtn.addEventListener('click', () => createNewInFolder('folder', openFolderPath));

async function refreshTree() {
    if (!openFolderPath) return;
    try {
        treeData = await api.listDir(openFolderPath);
        renderTree(treeData, fileTree, 0, openFolderPath);
    } catch (e) {
        fileTree.innerHTML = `<div class="tree-empty text-red">Error: ${e.message}</div>`;
    }
}

function renderTree(nodes, container, depth, parentPath) {
    if (!nodes || nodes.length === 0) {
        if (depth === 0) container.innerHTML = '<div class="tree-empty">Empty folder</div>';
        return;
    }
    if (depth === 0) container.innerHTML = '';

    nodes.forEach(node => {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.style.setProperty('--depth', depth);
        item.dataset.path = node.path;
        item.dataset.type = node.type;

        const icon = node.type === 'dir' ? getFileIcon('dir') : getFileIcon(node.name);
        item.innerHTML = `
      <span class="ti-icon">${icon}</span>
      <span class="ti-name">${node.name}</span>
      <span class="ti-actions">
        ${node.type === 'dir' ? `<button class="ti-action-btn" data-action="new-file-here" title="New File">📄</button>` : ''}
        <button class="ti-action-btn" data-action="rename" title="Rename">✏️</button>
        <button class="ti-action-btn" data-action="delete" title="Delete">🗑</button>
      </span>
    `;

        item.addEventListener('click', async (e) => {
            if (e.target.closest('.ti-actions')) return;
            if (node.type === 'file') {
                openFileInEditor(node.path, node.name);
                document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            } else {
                const childrenContainer = item.nextElementSibling;
                if (childrenContainer && childrenContainer.dataset.parentDir === node.path) {
                    childrenContainer.style.display = childrenContainer.style.display === 'none' ? '' : 'none';
                    item.querySelector('.ti-icon').textContent = childrenContainer.style.display === 'none'
                        ? '📁' : '📂';
                }
            }
        });

        item.addEventListener('click', async (e) => {
            const btn = e.target.closest('.ti-action-btn');
            if (!btn) return;
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'rename') await renameItem(node.path, node.name);
            if (action === 'delete') await deleteItem(node.path, node.name);
            if (action === 'new-file-here') await createNewInFolder('file', node.path);
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            currentCtxTarget = node;
            showContextMenu(e.clientX, e.clientY, node.type);
        });

        container.appendChild(item);

        if (node.type === 'dir' && node.children) {
            const childContainer = document.createElement('div');
            childContainer.dataset.parentDir = node.path;
            container.appendChild(childContainer);
            renderTree(node.children, childContainer, depth + 1, node.path);
        }
    });
}

function getFileIcon(name) {
    if (name === 'dir') return '📁';
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
        js: '🟨', ts: '🔷', jsx: '⚛️', tsx: '⚛️',
        html: '🌐', css: '🎨', scss: '🎨',
        json: '📋', md: '📝', txt: '📄',
        py: '🐍', rb: '💎', java: '☕',
        c: '⚙️', cpp: '⚙️', cs: '💠',
        go: '🐹', rs: '🦀', php: '🐘',
        sh: '🖥️', bat: '🖥️', sql: '🗄️',
        png: '🖼️', jpg: '🖼️', svg: '🖼️', gif: '🖼️',
        zip: '📦', env: '🔒', gitignore: '🙈',
    };
    return icons[ext] || '📄';
}

// ═══════════════════════════════════════════════
// EDITOR PANEL
// ═══════════════════════════════════════════════
function setupEditorPanel() {
    editorTabNew.addEventListener('click', () => openScratchTab());

    editorTextarea.addEventListener('click', updateEditorStatus);
    editorTextarea.addEventListener('keyup', updateEditorStatus);

    editorTextarea.addEventListener('input', () => {
        const tab = editorTabs.find(t => t.id === activeTabId);
        if (tab && !tab.modified) {
            tab.modified = true;
            renderTabs();
            editorLint.className = 'lint-modified';
            editorLint.textContent = getEditorStatusText() + ' ● Modified';
        }
    });

    fixCodeBtn.addEventListener('click', () => sendCodeToAI('fix'));
    explainBtn.addEventListener('click', () => sendCodeToAI('explain'));
    saveFileBtn.addEventListener('click', saveActiveFile);

    openScratchTab();
}

function openScratchTab() {
    const id = 'scratch-' + scratchCounter++;
    const name = `scratch${scratchCounter - 1}.js`;
    editorTabs.push({ id, name, path: null, content: '', modified: false });
    renderTabs();
    activateTab(id);
}

function openGeneratedTab(name, content) {
    syncTabContent();
    const id = 'generated-' + Date.now();
    editorTabs.push({ id, name, path: null, content, modified: false });
    renderTabs();
    activateTab(id);
}

async function openFileInEditor(filePath, name) {
    const existing = editorTabs.find(t => t.path === filePath);
    if (existing) { activateTab(existing.id); return; }

    try {
        const content = await api.readFile(filePath);
        const id = 'tab-' + Date.now();
        editorTabs.push({ id, name, path: filePath, content, modified: false });
        renderTabs();
        activateTab(id);
    } catch (e) {
        appendSystemMessage('❌ Cannot open file: ' + e.message, 'error');
    }
}

function activateTab(id) {
    activeTabId = id;
    const tab = editorTabs.find(t => t.id === id);
    if (!tab) return;
    editorTextarea.value = tab.content;
    editorActiveFile.textContent = tab.path || tab.name;
    editorActiveFile.title = tab.path || '';
    renderTabs();
    updateEditorStatus();
    editorTextarea.focus();
}

function renderTabs() {
    const newBtn = editorTabNew;
    editorTabBar.innerHTML = '';

    editorTabs.forEach(tab => {
        const div = document.createElement('div');
        div.className = 'editor-tab' + (tab.id === activeTabId ? ' active' : '');
        div.dataset.tabId = tab.id;
        div.innerHTML = `
      <span>${getFileIcon(tab.name)} ${tab.name}${tab.modified ? ' ●' : ''}</span>
      <span class="tab-close" title="Close">✕</span>
    `;
        div.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-close')) {
                closeTab(tab.id);
            } else {
                syncTabContent();
                activateTab(tab.id);
            }
        });
        editorTabBar.appendChild(div);
    });

    editorTabBar.appendChild(newBtn);
}

function syncTabContent() {
    const tab = editorTabs.find(t => t.id === activeTabId);
    if (tab) tab.content = editorTextarea.value;
}

function closeTab(id) {
    syncTabContent();
    const idx = editorTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = editorTabs[idx];

    if (tab.modified) {
        const confirmed = confirm(`"${tab.name}" has unsaved changes. Close anyway?`);
        if (!confirmed) return;
    }

    editorTabs.splice(idx, 1);

    if (editorTabs.length === 0) openScratchTab();
    else {
        const newActive = editorTabs[Math.min(idx, editorTabs.length - 1)];
        activateTab(newActive.id);
    }
    renderTabs();
}

async function saveActiveFile() {
    syncTabContent();
    const tab = editorTabs.find(t => t.id === activeTabId);
    if (!tab) return;

    if (!tab.path) {
        const name = await showModal('Save As — enter file name:', tab.name);
        if (!name) return;
        const base = openFolderPath || api.getHomeDir();
        tab.path = base + '/' + name;
        tab.name = name;
    }

    try {
        await api.writeFile(tab.path, tab.content);
        tab.modified = false;
        renderTabs();
        editorLint.className = 'lint-saved';
        editorLint.textContent = getEditorStatusText() + ' ✓ Saved';
        editorActiveFile.textContent = tab.path;
        if (openFolderPath) refreshTree();
        setTimeout(() => { editorLint.className = ''; updateEditorStatus(); }, 3000);
    } catch (e) {
        appendSystemMessage('❌ Save failed: ' + e.message, 'error');
    }
}

function updateEditorStatus() {
    editorLint.textContent = getEditorStatusText();
}

function getEditorStatusText() {
    const text = editorTextarea.value;
    const before = text.slice(0, editorTextarea.selectionStart);
    const lines = before.split('\n');
    const ln = lines.length;
    const col = lines[lines.length - 1].length + 1;
    const total = text.split('\n').length;
    const chars = text.length;
    return `Ln ${ln}, Col ${col}  |  ${total} lines  |  ${chars} chars  |  UTF-8`;
}

async function sendCodeToAI(mode) {
    syncTabContent();
    const code = editorTextarea.value.trim();
    if (!code) {
        appendSystemMessage('⚠️ Editor is empty. Paste code first.', 'error');
        return;
    }

    const prompts = {
        fix: 'Please fix all bugs and issues in the following code and return the corrected version with a short explanation of the changes:',
        explain: 'Please explain the following code in detail — what it does, how it works, and any important patterns or potential issues:',
    };

    $('ab-chat').click();
    promptInput.value = prompts[mode];
    await sendMessage();
}

// ═══════════════════════════════════════════════
// CONTEXT MENU (right-click on file tree)
// ═══════════════════════════════════════════════
function setupContextMenu() {
    contextMenu.querySelectorAll('.ctx-item').forEach(item => {
        item.addEventListener('click', async () => {
            const action = item.dataset.action;
            hideContextMenu();
            if (!currentCtxTarget) return;

            if (action === 'open' && currentCtxTarget.type === 'file') {
                openFileInEditor(currentCtxTarget.path, currentCtxTarget.name);
            }
            if (action === 'rename') await renameItem(currentCtxTarget.path, currentCtxTarget.name);
            if (action === 'delete') await deleteItem(currentCtxTarget.path, currentCtxTarget.name);
            if (action === 'new-file') await createNewInFolder('file', currentCtxTarget.path);
            if (action === 'new-folder') await createNewInFolder('folder', currentCtxTarget.path);
            if (action === 'reveal') await api.revealFile(currentCtxTarget.path);
        });
    });

    document.addEventListener('click', hideContextMenu);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });
}

function showContextMenu(x, y, type) {
    contextMenu.classList.add('visible');
    contextMenu.style.left = Math.min(x, window.innerWidth - 170) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - 200) + 'px';

    contextMenu.querySelector('[data-action="open"]').style.display = type === 'file' ? '' : 'none';
    contextMenu.querySelector('[data-action="new-file"]').style.display = type === 'dir' ? '' : 'none';
    contextMenu.querySelector('[data-action="new-folder"]').style.display = type === 'dir' ? '' : 'none';
}

function hideContextMenu() {
    contextMenu.classList.remove('visible');
}

// ═══════════════════════════════════════════════
// FILE OPERATIONS
// ═══════════════════════════════════════════════
async function renameItem(oldPath, oldName) {
    const newName = await showModal('Rename:', oldName);
    if (!newName || newName === oldName) return;
    const pathParts = oldPath.split(/[\\\/]/);
    pathParts[pathParts.length - 1] = newName;
    const newPath = pathParts.join('/');
    try {
        await api.renameFile(oldPath, newPath);
        editorTabs.forEach(tab => { if (tab.path === oldPath) { tab.path = newPath; tab.name = newName; } });
        renderTabs();
        await refreshTree();
    } catch (e) {
        appendSystemMessage('❌ Rename failed: ' + e.message, 'error');
    }
}

async function deleteItem(filePath, name) {
    const ok = await showModal(`Delete "${name}"? This cannot be undone.`, '', true);
    if (!ok) return;
    try {
        await api.deleteFile(filePath);
        const tab = editorTabs.find(t => t.path === filePath);
        if (tab) closeTab(tab.id);
        await refreshTree();
    } catch (e) {
        appendSystemMessage('❌ Delete failed: ' + e.message, 'error');
    }
}

async function createNewInFolder(type, parentPath) {
    if (!parentPath) {
        appendSystemMessage('⚠️ Open a folder first.', 'error');
        return;
    }
    const label = type === 'file' ? 'New file name:' : 'New folder name:';
    const defVal = type === 'file' ? 'untitled.js' : 'new-folder';
    const name = await showModal(label, defVal);
    if (!name) return;

    const newPath = parentPath.replace(/[\\\/]$/, '') + '/' + name;
    try {
        if (type === 'file') {
            await api.createFile(newPath);
            await refreshTree();
            openFileInEditor(newPath, name);
        } else {
            await api.createFolder(newPath);
            await refreshTree();
        }
    } catch (e) {
        appendSystemMessage('❌ Create failed: ' + e.message, 'error');
    }
}

// ═══════════════════════════════════════════════
// MODAL (generic prompt dialog)
// ═══════════════════════════════════════════════
function setupModal() {
    modalCancel.addEventListener('click', () => resolveModal(null));
    modalConfirm.addEventListener('click', () => {
        resolveModal(modalIsConfirm ? true : modalInput.value);
    });
    modalInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') resolveModal(modalInput.value);
        if (e.key === 'Escape') resolveModal(null);
    });
}

function showModal(title, defaultValue = '', isConfirm = false) {
    return new Promise(resolve => {
        modalResolver = resolve;
        modalIsConfirm = isConfirm;
        modalTitle.textContent = title;
        modalInput.value = defaultValue;
        modalInput.style.display = isConfirm ? 'none' : 'block';
        modalConfirm.textContent = isConfirm ? 'Confirm' : 'OK';
        modalConfirm.className = isConfirm ? 'modal-btn confirm danger' : 'modal-btn confirm';
        modalOverlay.classList.add('visible');
        if (!isConfirm) { modalInput.focus(); modalInput.select(); }
    });
}

function resolveModal(value) {
    modalOverlay.classList.remove('visible');
    modalIsConfirm = false;
    if (modalResolver) {
        modalResolver(value);
        modalResolver = null;
    }
}

async function setOpenFolder(folderPath) {
    openFolderPath = folderPath;
    sbFolder.textContent = '📁 ' + folderPath.split(/[\\\/]/).pop();
    sbFolder.title = folderPath;
    await refreshTree();
}

async function showSystemRoots() {
    openFolderPath = null;
    sbFolder.textContent = '📁 No folder';
    sbFolder.title = 'No folder open';

    try {
        const roots = await api.listRoots();
        renderRootPicker(roots);
    } catch (e) {
        fileTree.innerHTML = `<div class="tree-empty text-red">Error: ${e.message}</div>`;
    }
}

function renderRootPicker(roots) {
    if (!roots || roots.length === 0) {
        fileTree.innerHTML = '<div class="tree-empty">No local folders found.</div>';
        return;
    }

    fileTree.innerHTML = `
      <div class="tree-empty" style="padding-bottom:10px">
        Choose a local folder from your PC to open it in the app.
      </div>
    `;

    roots.forEach(root => {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.style.setProperty('--depth', 0);
        item.innerHTML = `
          <span class="ti-icon">📁</span>
          <span class="ti-name">${root.name}</span>
        `;
        item.title = root.path;
        item.addEventListener('click', () => setOpenFolder(root.path));
        fileTree.appendChild(item);
    });
}

// ═══════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════
function setupStatusBar() {
    $('sb-target').addEventListener('click', async () => {
        const next = currentConfig.aiTarget === 'gemini' ? 'chatgpt' : 'gemini';
        try {
            await api.updateConfig({ aiTarget: next });
            currentConfig.aiTarget = next;
            sbTargetLabel.textContent = next;
            appendSystemMessage(`🔄 Switched AI target to <strong>${next}</strong>. Takes effect on next prompt.`);
        } catch (e) {
            appendSystemMessage('❌ Could not switch target: ' + e.message, 'error');
        }
    });
}

function setStatus(text, spinning = false) {
    sbStatusText.textContent = text;
    sbSpinner.classList.toggle('visible', spinning);
}

// ═══════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════
document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveActiveFile(); }
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openScratchTab(); }
    if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
    if (e.ctrlKey && e.key === '`') { e.preventDefault(); toggleTerminalPanel(); }
});

// ═══════════════════════════════════════════════
// TERMINAL
// ═══════════════════════════════════════════════

// ── State ──
let terminalTabs = [];
let activeTermId = null;
let termTabCounter = 0;
let cmdHistory = [];
let cmdHistoryIdx = -1;

// ── DOM refs ──
const terminalPanel = $('terminal-panel');
const terminalTabBar = $('terminal-tab-bar');
const terminalOutput = $('terminal-output');
const terminalInputEl = $('terminal-input');
const terminalNewBtn = $('terminal-new-btn');
const terminalCloseBtn = $('terminal-close-btn');
const terminalSendBtn = $('terminal-send-btn');
const termResizeHandle = $('terminal-resize-handle');
const abTerminal = $('ab-terminal');

function setupTerminal() {
    // IPC stream listeners (registered once at setup)
    api.onTermData((_, id, chunk) => appendTermOutput(id, chunk));
    api.onTermExit((_, id, code) => {
        const tab = terminalTabs.find(t => t.id === id);
        if (!tab) return;
        tab.exited = true;
        tab.name = tab.name.replace('🟢', '🔴');
        appendTermOutput(id, `\r\n[Process exited with code ${code ?? 0}]\r\n`);
        renderTermTabs();
    });

    terminalNewBtn.addEventListener('click', () => createTerminal());
    terminalCloseBtn.addEventListener('click', hideTerminalPanel);

    const sendCommand = () => {
        const text = terminalInputEl.value;
        if (!activeTermId) return;
        appendTermOutput(activeTermId, text + '\n', true);
        api.termWrite(activeTermId, text + '\n');
        if (text.trim()) {
            cmdHistory.unshift(text);
            if (cmdHistory.length > 50) cmdHistory.pop();
        }
        cmdHistoryIdx = -1;
        terminalInputEl.value = '';
    };

    terminalSendBtn.addEventListener('click', sendCommand);
    terminalInputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); sendCommand(); return; }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (cmdHistoryIdx < cmdHistory.length - 1)
                terminalInputEl.value = cmdHistory[++cmdHistoryIdx];
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (cmdHistoryIdx > 0) terminalInputEl.value = cmdHistory[--cmdHistoryIdx];
            else { cmdHistoryIdx = -1; terminalInputEl.value = ''; }
            return;
        }
        if (e.ctrlKey && e.key === 'c') {
            e.preventDefault();
            if (activeTermId) {
                api.termWrite(activeTermId, '\x03');
                appendTermOutput(activeTermId, '^C\n', true);
            }
        }
    });

    setupTerminalResize();
}

async function createTerminal() {
    try {
        const result = await api.termCreate(openFolderPath || null);
        const id = result.id;
        const name = `🟢 Terminal ${++termTabCounter}`;
        terminalTabs.push({ id, name, outputHtml: '', exited: false });
        renderTermTabs();
        activateTermTab(id);
    } catch (e) {
        appendSystemMessage('❌ Could not start terminal: ' + e.message, 'error');
    }
}

function renderTermTabs() {
    terminalTabBar.innerHTML = '';
    terminalTabs.forEach(tab => {
        const div = document.createElement('div');
        div.className = 'terminal-tab' + (tab.id === activeTermId ? ' active' : '');
        div.innerHTML = `<span>${tab.name}</span><span class="tt-close" title="Close">✕</span>`;
        div.addEventListener('click', e => {
            e.target.classList.contains('tt-close') ? closeTermTab(tab.id) : activateTermTab(tab.id);
        });
        terminalTabBar.appendChild(div);
    });
}

function activateTermTab(id) {
    activeTermId = id;
    renderTermTabs();
    const tab = terminalTabs.find(t => t.id === id);
    terminalOutput.innerHTML = tab ? tab.outputHtml : '';
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
    terminalInputEl.focus();
}

function closeTermTab(id) {
    const idx = terminalTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    terminalTabs.splice(idx, 1);
    if (terminalTabs.length === 0) {
        hideTerminalPanel();
        terminalOutput.innerHTML = '';
        activeTermId = null;
        termTabCounter = 0;
    } else {
        activateTermTab(terminalTabs[Math.min(idx, terminalTabs.length - 1)].id);
    }
    renderTermTabs();
    api.termKill(id);
}

function appendTermOutput(id, chunk, isCmd = false) {
    const tab = terminalTabs.find(t => t.id === id);
    if (!tab) return;

    const html = formatTerminalChunk(chunk, isCmd);
    tab.outputHtml += html;

    if (id !== activeTermId) return;

    terminalOutput.insertAdjacentHTML('beforeend', html);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function formatTerminalChunk(chunk, isCmd) {
    return `<span class="term-line${isCmd ? ' term-cmd' : ''}">${ansiToHtml(chunk)}</span>`;
}

function ansiToHtml(text) {
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const clsMap = {
        '1': 'ansi-bold', '2': 'ansi-dim',
        '31': 'ansi-red', '32': 'ansi-green', '33': 'ansi-yellow',
        '34': 'ansi-blue', '35': 'ansi-magenta', '36': 'ansi-cyan', '37': 'ansi-white',
    };
    html = html.replace(/\x1b\[([0-9;]*)m/g, (_, codes) => {
        if (!codes || codes === '0') return '</span>';
        const cls = codes.split(';').map(c => clsMap[c]).filter(Boolean).join(' ');
        return cls ? `<span class="${cls}">` : '';
    });
    html = html.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    html = html.replace(/\x1b\][^\x07]*\x07/g, '');
    html = html.replace(/\r/g, '');
    return html;
}

function toggleTerminalPanel() {
    terminalPanel.classList.contains('hidden') ? showTerminalPanel() : hideTerminalPanel();
}

function showTerminalPanel() {
    terminalPanel.classList.remove('hidden');
    abTerminal.classList.add('active');
    if (terminalTabs.length === 0) createTerminal();
    else terminalInputEl.focus();
}

function hideTerminalPanel() {
    terminalPanel.classList.add('hidden');
    abTerminal.classList.remove('active');
}

function setupTerminalResize() {
    let dragging = false, startY = 0, startH = 0;

    termResizeHandle.addEventListener('mousedown', e => {
        dragging = true;
        startY = e.clientY;
        startH = terminalPanel.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const newH = Math.max(80, Math.min(startH + (startY - e.clientY), window.innerHeight * 0.7));
        terminalPanel.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (dragging) { dragging = false; document.body.style.cursor = ''; }
    });
}

// ─── Start ───
init();
