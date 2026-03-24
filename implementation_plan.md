# Add Integrated Terminal Panel

The AI IDE Assistant currently has Chat, File Explorer, and Code Editor panels. This plan adds a full **integrated terminal panel** (like VS Code's) — a resizable panel at the bottom of the editor area that spawns a real shell (PowerShell on Windows, bash elsewhere), streams stdout/stderr to the UI, and accepts stdin. Supports multiple named terminal tabs.

## Proposed Changes

### Main Process

#### [MODIFY] [main.js](file:///d:/Files/New%20folder/ai-ide-assistant/src/ui/main.js)

Add IPC handlers using Node's `child_process.spawn` to:
- `terminal-create` — spawn a new PowerShell/bash process, return a `termId`. Register stdout/stderr data listeners that push to renderer via `webContents.send`.
- `terminal-write` — write a string to the terminal's stdin.
- `terminal-resize` — send resize signal (cols/rows) to the PTY.
- `terminal-kill` — kill a terminal by ID.

> **Implementation note**: Use `node-pty` for a real PTY, but since adding native dependencies is complex, we'll use `child_process.spawn` with `{ shell: true }` + stdio pipes for simplicity. Output will stream chunk-by-chunk via IPC.

---

### Preload Bridge

#### [MODIFY] [preload.js](file:///d:/Files/New%20folder/ai-ide-assistant/src/ui/preload.js)

Add to `window.api`:
- `termCreate(cwd)` → `ipcRenderer.invoke('terminal-create', cwd)`
- `termWrite(id, data)` → `ipcRenderer.send('terminal-write', id, data)`
- `termKill(id)` → `ipcRenderer.send('terminal-kill', id)`
- `onTermData(callback)` → `ipcRenderer.on('terminal-data', callback)` (streaming output)
- `onTermExit(callback)` → `ipcRenderer.on('terminal-exit', callback)`

---

### HTML Structure

#### [MODIFY] [index.html](file:///d:/Files/New%20folder/ai-ide-assistant/src/ui/index.html)

- Add a **terminal activity bar button** (🖥️) with `data-panel="terminal"` in the sidebar activity bar.
- Add a **terminal panel** below `content-area` inside `#workspace`:
  ```
  #terminal-panel
    #terminal-tab-bar (tabs + "+" new terminal button)
    #terminal-output   (scrollable pre/div where output streams)
    #terminal-input-row
      #terminal-input  (text input for stdin)
      #terminal-send   (Enter / button)
  ```
- The panel has a resize handle at the top edge (drag to resize height).

---

### Styles

#### [MODIFY] [styles.css](file:///d:/Files/New%20folder/ai-ide-assistant/src/ui/styles.css)

- `#terminal-panel` — dark background (`#0d1117`), monospace font, positioned at bottom of `#content-area` via flex column layout on a wrapper div.
- Terminal tab bar styled like `#editor-tab-bar`.
- `#terminal-output` — `overflow-y: auto`, ANSI color support via CSS classes.
- Resize handle: thin strip at top that changes cursor and lets user drag to resize panel height.
- Scrollbar styling consistent with rest of app.

---

### Renderer Logic

#### [MODIFY] [renderer.js](file:///d:/Files/New%20folder/ai-ide-assistant/src/ui/renderer.js)

Add `setupTerminal()` called from [init()](file:///d:/Files/New%20folder/ai-ide-assistant/src/ui/renderer.js#68-91):
- **Terminal state**: `terminalTabs = []`, `activeTermId = null`
- **`createTerminal(cwd)`**: calls `api.termCreate(cwd)`, pushes tab, renders tab bar
- **Stream listener**: `api.onTermData((e, id, chunk) => appendTermOutput(id, chunk))`
- **`appendTermOutput(id, chunk)`**: basic ANSI escape stripping + appends to `#terminal-output`, auto-scrolls
- **Input handling**: Enter key on `#terminal-input` sends data via `api.termWrite(id, text + '\n')`
- **Tab switching / closing**: similar pattern to editor tabs
- **Activity bar integration**: terminal tab toggle shows/hides `#terminal-panel` (panel appears at bottom of content area, not sidebar)
- **Resize handle drag**: `mousedown` → `mousemove` updates panel height via `style.height`
- **Auto cwd**: when creating a terminal, use `openFolderPath` if set

## Verification Plan

### Manual Verification

1. Run the app: `npm run dev` in `d:\Files\New folder\ai-ide-assistant`
2. Click the **🖥️** terminal button in the left activity bar
3. Verify a terminal panel opens at the bottom with a tab "Terminal 1"
4. Type `echo hello world` + Enter → confirm output appears
5. Type `dir` (Windows) → confirm directory listing streams in
6. Click `+` to create a second terminal tab, switch between them
7. Close a terminal tab — verify process is killed
8. Open a folder in the explorer, then open terminal — verify cwd matches the open folder
9. Drag the resize handle (top edge of terminal panel) up/down to resize
