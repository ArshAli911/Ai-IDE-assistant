// main.js - Electron main process
// Spawns Express server, creates the BrowserWindow, and handles all IPC calls
// (AI prompts, conversation history, file system operations for the project explorer)
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork, spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;

// Terminal processes: Map<termId, { proc, id }>
const terminals = new Map();
let termIdCounter = 0;

function killTerminal(id) {
    const term = terminals.get(id);
    if (!term) return;

    terminals.delete(id);

    try {
        if (term.proc.stdin && !term.proc.stdin.destroyed) {
            term.proc.stdin.end();
        }
    } catch { /* ignore */ }

    try {
        term.proc.kill();
    } catch { /* ignore */ }
}

function killAllTerminals() {
    for (const id of Array.from(terminals.keys())) {
        killTerminal(id);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 15000) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
            lastError = new Error(`HTTP ${res.status}`);
        } catch (err) {
            lastError = err;
        }
        await delay(250);
    }

    throw lastError || new Error('Server readiness check timed out');
}

// Create the main window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#0d1117',
        titleBarStyle: 'hidden',
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: path.join(__dirname, 'icon.png'),
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Open DevTools in development
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => { mainWindow = null; });
}

// Start the Express server as a child process
function startServer() {
    const serverPath = path.join(__dirname, '../backend/server.js');
    serverProcess = fork(serverPath, [], { silent: false });

    serverProcess.on('error', (err) => {
        console.error('Server process error:', err);
    });

    serverProcess.on('message', (message) => {
        if (message && message.type === 'server-ready') {
            console.log('Server reported ready on port', message.port);
        }
    });

    serverProcess.on('exit', (code) => {
        console.log('Server process exited with code:', code);
    });
}

// App lifecycle
app.whenReady().then(async () => {
    startServer();

    try {
        await waitForServer('http://127.0.0.1:3131/health');
        createWindow();
    } catch (err) {
        console.error('Backend failed to become ready:', err);
        dialog.showErrorBox(
            'Backend Startup Failed',
            'The local API server did not become ready.\n\n' + err.message
        );
        app.quit();
        return;
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        killAllTerminals();
        if (serverProcess) serverProcess.kill();
        app.quit();
    }
});

app.on('before-quit', async () => {
    killAllTerminals();
    try {
        const browserModule = require('../automation/browser');
        await browserModule.close();
    } catch { /* ignore */ }
    if (serverProcess) serverProcess.kill();
});

// =======================================================
// IPC HANDLERS
// =======================================================

// Window controls (frameless window)
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow && mainWindow.close());

// Open Folder Dialog
ipcMain.handle('open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Open Project Folder',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

ipcMain.handle('list-roots', () => {
    const roots = [];
    const seen = new Set();

    const addRoot = (label, dirPath) => {
        if (!dirPath) return;
        try {
            if (!fs.existsSync(dirPath)) return;
            const resolved = path.resolve(dirPath);
            if (seen.has(resolved)) return;
            seen.add(resolved);
            roots.push({ name: label, path: resolved, type: 'dir' });
        } catch { /* ignore invalid paths */ }
    };

    const homeDir = os.homedir();
    addRoot('Home', homeDir);
    addRoot('Desktop', path.join(homeDir, 'Desktop'));
    addRoot('Documents', path.join(homeDir, 'Documents'));
    addRoot('Downloads', path.join(homeDir, 'Downloads'));

    if (process.platform === 'win32') {
        for (let code = 67; code <= 90; code++) {
            const drive = String.fromCharCode(code) + ':\\';
            addRoot(drive, drive);
        }
    } else {
        addRoot('Root', path.parse(homeDir).root);
    }

    return roots;
});

// List directory tree
ipcMain.handle('list-dir', (_, dirPath) => {
    return buildTree(dirPath);
});

function buildTree(dirPath, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 8) return [];
    var SKIP = new Set(['node_modules', '.git', '.next', '__pycache__', 'dist', 'build', '.cache']);

    try {
        var entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries
            .filter(function (e) { return !SKIP.has(e.name); })
            .sort(function (a, b) {
                if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                return a.name.localeCompare(b.name);
            })
            .map(function (e) {
                var fullPath = path.join(dirPath, e.name);
                if (e.isDirectory()) {
                    return { name: e.name, path: fullPath, type: 'dir', children: buildTree(fullPath, depth + 1) };
                }
                return { name: e.name, path: fullPath, type: 'file' };
            });
    } catch (err) {
        return [];
    }
}

// Read file
ipcMain.handle('read-file', (_, filePath) => {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        throw new Error('Cannot read file: ' + e.message);
    }
});

// Write file
ipcMain.handle('write-file', (_, filePath, content) => {
    try {
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
    } catch (e) {
        throw new Error('Cannot write file: ' + e.message);
    }
});

// Create new file
ipcMain.handle('create-file', (_, filePath) => {
    try {
        fs.writeFileSync(filePath, '', 'utf8');
        return true;
    } catch (e) {
        throw new Error('Cannot create file: ' + e.message);
    }
});

// Create new folder
ipcMain.handle('create-folder', (_, dirPath) => {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        return true;
    } catch (e) {
        throw new Error('Cannot create folder: ' + e.message);
    }
});

// Rename file or folder
ipcMain.handle('rename-file', (_, oldPath, newPath) => {
    try {
        fs.renameSync(oldPath, newPath);
        return true;
    } catch (e) {
        throw new Error('Cannot rename: ' + e.message);
    }
});

// Delete file or folder
ipcMain.handle('delete-file', (_, filePath) => {
    try {
        var stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(filePath);
        }
        return true;
    } catch (e) {
        throw new Error('Cannot delete: ' + e.message);
    }
});

// Reveal in File Explorer
ipcMain.handle('reveal-file', (_, filePath) => {
    shell.showItemInFolder(filePath);
    return true;
});

// =======================================================
// TERMINAL IPC
// =======================================================

// Create a new terminal process
ipcMain.handle('terminal-create', (_, cwd) => {
    var id = ++termIdCounter;

    var isWin = process.platform === 'win32';
    var shellExe = isWin ? 'powershell.exe' : 'bash';
    var shellArgs = isWin ? ['-NoLogo'] : [];

    var workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

    var proc = spawn(shellExe, shellArgs, {
        cwd: workDir,
        env: Object.assign({}, process.env, { TERM: 'xterm-color' }),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });

    terminals.set(id, { proc: proc, id: id });

    proc.stdout.on('data', function (data) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal-data', id, data.toString());
        }
    });

    proc.stderr.on('data', function (data) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal-data', id, data.toString());
        }
    });

    proc.on('close', function (code) {
        terminals.delete(id);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal-exit', id, code);
        }
    });

    proc.on('error', function (err) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal-data', id, '\r\n[Error: ' + err.message + ']\r\n');
        }
    });

    if (proc.stdin) {
        proc.stdin.on('error', function () {
            /* ignore EPIPE after process exit */
        });
    }

    return { id: id, cwd: workDir };
});

// Write to terminal stdin
ipcMain.on('terminal-write', (_, id, data) => {
    var term = terminals.get(id);
    if (term && term.proc.stdin.writable) {
        term.proc.stdin.write(data);
    }
});

// Kill a terminal
ipcMain.on('terminal-kill', (_, id) => {
    killTerminal(id);
});
