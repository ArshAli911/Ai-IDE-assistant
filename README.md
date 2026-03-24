# AI IDE Assistant

A personal desktop IDE assistant powered by **browser automation** (Playwright) — no paid APIs required. Chat with Gemini or ChatGPT, edit your project files, and use AI to fix or explain your code, all from one dark-themed desktop app.

---

## Features

| Feature | Details |
|---|---|
| 🤖 AI Chat | Sends prompts to Gemini or ChatGPT via browser automation |
| 💾 Session Persistence | Login once — cookies saved, no re-login needed |
| ⚡ Response Cache | SHA-256 keyed cache — identical prompts answered instantly |
| 📁 Project Explorer | Open any folder, browse the file tree, create/rename/delete files |
| ✏️ Inline Editor | Multi-tab code editor with save-to-disk (Ctrl+S) |
| 🔧 Fix / Explain | Send editor code to AI with one click |
| 📜 History Sidebar | Full conversation history saved locally |
| 🔄 Switch AI Target | Toggle Gemini ↔ ChatGPT from the status bar |
| ⚙️ Settings Panel | Configure target, delays, timeouts from inside the app |

---

## Project Structure

```
ai-ide-assistant/
├── config.json              ← User settings (edit to change AI target, delays, etc.)
├── package.json
├── data/                    ← Auto-created at runtime
│   ├── cache.json
│   ├── history.json
│   ├── session/             ← Playwright browser cookies (DO NOT delete while logged in)
│   └── logs/automation.log
└── src/
    ├── backend/             ← Express API server
    │   ├── server.js
    │   ├── cache.js
    │   ├── history.js
    │   └── logger.js
    ├── automation/          ← Playwright adapters
    │   ├── browser.js
    │   ├── selectors.js
    │   ├── gemini.js
    │   ├── chatgpt.js
    │   └── detector.js
    └── ui/                  ← Electron window
        ├── main.js
        ├── preload.js
        ├── index.html
        ├── renderer.js
        └── styles.css
```

---

## Setup

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or later
- Windows / macOS / Linux

### 1. Install dependencies
```powershell
cd "d:\Files\New folder\ai-ide-assistant"
npm install
```

### 2. Install Playwright's Chromium browser
```powershell
npm run install-browsers
```

### 3. Launch the app
```powershell
npm start
```

---

## First-Time Login

1. On first launch, a **Chromium browser window** will open when you send your first prompt
2. **Log into Gemini** (or ChatGPT if configured) in that browser window — this is a one-time step
3. Your session cookies are saved to `data/session/` — future launches will stay logged in
4. Go back to the Electron app and resend your prompt

> **Tip:** Keep the Playwright browser window available. If a CAPTCHA appears, the app will notify you to solve it there.

---

## Configuration (`config.json`)

| Key | Default | Description |
|---|---|---|
| `aiTarget` | `"gemini"` | `"gemini"` or `"chatgpt"` |
| `requestDelay` | `1500` | Milliseconds to wait between requests |
| `responseTimeout` | `60000` | Max wait for AI response (ms) |
| `maxRetries` | `3` | Retry attempts on failure |
| `streamStableMs` | `1500` | How long response must be unchanged to be "done" |
| `headless` | `false` | Run browser invisibly (not recommended for first login) |

You can also change these from inside the app via ⚙️ Settings.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Send prompt |
| `Shift+Enter` | New line in prompt |
| `Ctrl+S` | Save current file |
| `Ctrl+N` | New scratch tab |
| `Ctrl+W` | Close current tab |

---

## Switching AI Target

Click the **🤖 gemini** label in the status bar to toggle between Gemini and ChatGPT. The switch takes effect on the next prompt. Make sure you're logged into whichever target you switch to.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| "NOT_LOGGED_IN" error | Log in via the Playwright browser window that opens |
| "CAPTCHA_DETECTED" | Solve the CAPTCHA in the Playwright window, then retry |
| Response is cut off | Increase `responseTimeout` in config |
| Empty response | Increase `streamStableMs` so the app waits longer for streaming |
| App won't start | Run `npm install` and `npm run install-browsers` again |

---

## ⚠️ Disclaimer

This tool is for **personal use only**. It automates a browser session you already own. Respect each platform's terms of service and use responsibly.
