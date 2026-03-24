// preload.js — Context bridge between Electron main process and renderer
// Exposes a safe, typed API via window.api — no direct Node/IPC access from renderer
const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

async function requestJson(url, options = {}, allowEmpty = false) {
    const res = await fetch(url, options);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
        throw new Error(data?.error || res.statusText || 'Server error');
    }

    return allowEmpty ? data : (data ?? {});
}

contextBridge.exposeInMainWorld('api', {

    // ── Window controls ──
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    getHomeDir: () => os.homedir(),

    // ── AI Prompt (via Express server) ──
    sendPrompt: (prompt, codeContext) =>
        requestJson('http://127.0.0.1:3131/prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, codeContext }),
        }, true),
    crawlSite: (url, maxPages) =>
        requestJson('http://127.0.0.1:3131/crawl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, maxPages }),
        }, true),

    // ── Conversation history ──
    getHistory: () => requestJson('http://127.0.0.1:3131/history', {}, true),
    clearHistory: () => requestJson('http://127.0.0.1:3131/history', { method: 'DELETE' }, true),

    // ── Config ──
    getConfig: () => requestJson('http://127.0.0.1:3131/config', {}, true),
    updateConfig: (updates) =>
        requestJson('http://127.0.0.1:3131/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        }, true),

    // ── File System (via IPC to main process) ──
    openFolder: () => ipcRenderer.invoke('open-folder'),
    listRoots: () => ipcRenderer.invoke('list-roots'),
    listDir: (dirPath) => ipcRenderer.invoke('list-dir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
    createFile: (filePath) => ipcRenderer.invoke('create-file', filePath),
    createFolder: (dirPath) => ipcRenderer.invoke('create-folder', dirPath),
    renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    revealFile: (filePath) => ipcRenderer.invoke('reveal-file', filePath),

    // ── Terminal (via IPC to main process) ──
    termCreate: (cwd) => ipcRenderer.invoke('terminal-create', cwd),
    termWrite: (id, data) => ipcRenderer.send('terminal-write', id, data),
    termKill: (id) => ipcRenderer.send('terminal-kill', id),
    onTermData: (cb) => ipcRenderer.on('terminal-data', cb),
    onTermExit: (cb) => ipcRenderer.on('terminal-exit', cb),
});
