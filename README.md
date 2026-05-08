# Claude Code Manager

A desktop session manager for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), built with Electron + React. Think iTerm2 for Claude Code — discover, resume, and juggle multiple Claude Code sessions from a single app with a proper UI.

## Overview

Claude Code's built-in session management is minimal: you get `claude --resume <id>` in a terminal, and that's about it. If you work across multiple projects or revisit past conversations frequently, keeping track of sessions becomes painful fast.

Claude Code Manager solves this by wrapping real `claude` processes in a tabbed GUI. It doesn't use the Anthropic API — it spawns actual Claude Code CLI instances via PTY, so it works with any setup: personal accounts, corporate SSO, whatever authentication your `claude` binary already has configured.

## Features

### Session Management

Discovers all existing sessions from `~/.claude/projects/` and displays them in a searchable, sortable sidebar. Each session shows an auto-generated title (from the first message), working directory, last active time, and message count. You can rename sessions (double-click or right-click), pin favorites to the top, archive ones you want to hide, or delete them permanently.

### Multi-Tab Sessions

Open multiple sessions simultaneously as tabs — each backed by its own PTY process. Switching tabs doesn't kill background sessions. A green dot in the sidebar and tab bar indicates which sessions are live.

### Chat UI

PTY output is parsed into a clean chat view with user/Claude message bubbles. ANSI escape codes are stripped, tool call blocks (Read, Bash, Edit, etc.) render as collapsible cards, and echoed input is deduplicated. Messages have copy buttons on hover and timestamps on hover. A typing indicator appears while Claude is responding, and auto-scroll pauses when you scroll up to read.

### Raw Terminal

Toggle a side-by-side xterm.js terminal per session to see the raw PTY output — useful for inspecting tool calls, file diffs, and anything the chat parser simplifies away. Keyboard input in the raw terminal goes directly to the PTY.

### New Session

Click "+ New Session" to get a modal with a native directory picker and optional session name. The session spawns immediately and the tab title auto-updates from the first exchange if you didn't name it.

### Settings

Accessible via the gear icon or `Cmd+,`. Configure the Claude binary path (auto-detected, with a Verify button), default working directory, theme, font sizes for chat and terminal, auto-scroll behavior, and whether new sessions show the raw terminal by default. A danger zone lets you clear all custom metadata or reset to defaults.

### Context Panel (CLAUDE.md)

Press `Cmd+E` to open a split editor panel alongside the terminal that reads and edits the `CLAUDE.md` file in the session's working directory. This is the file Claude Code uses for project-level instructions and context. You can create, edit, save (`Cmd+S`), or delete it directly from the app without switching to a separate editor.

### Multi-Session Dialogue

Make two or more Claude Code sessions talk to each other. When a dialogue is active, the app waits for one session to finish responding, extracts the clean text (stripping ANSI codes and Claude Code UI artifacts), and forwards it as input to the next session — automatically, in a loop.

Three modes are available: **Pair** (two sessions ping-pong back and forth), **Pipeline** (responses flow round-robin through all sessions), and **Broadcast** (same as pipeline, for now). Each session can be given an optional **role prompt** before the dialogue starts (e.g. "You are a code reviewer"), and you provide an **initial message** to kick things off.

The dialogue runs until one of: max turn count reached, a configurable stop keyword appears in a response, a session exits, or you manually stop it. A dedicated Dialogue View shows the full transcript with color-coded turns, an active-session indicator, and Pause/Resume/Stop controls.

### Remote Sessions (SSH)

Configure SSH connections in **Settings > Remote Hosts** (host, user, port, optional key path) to discover and manage sessions on remote machines. Remote sessions appear in the sidebar with a cyan `[user@host]` label and can be filtered via the **All / Local / Remote** buttons. You can resume, create (with manual remote path entry), and delete remote sessions just like local ones — the app runs `ssh -t` with the remote user's login shell so `nvm`/`PATH` are initialized correctly.

The discovery process scans `~/.claude/projects/` over SSH on each configured host (asynchronously, so a slow or unreachable host doesn't block the local session list). SSH connections set `ClearAllForwardings=yes` to avoid clobbering existing port forwards configured in your `~/.ssh/config`.

### Session Overview

Press `Cmd+O` for a dashboard-style grid of all live sessions. Each card shows the session title, working directory, and a live preview of the most recent terminal output (cleaned of UI artifacts, updated every 500ms). Click any card to switch to that tab. The active session has an indigo border. PTY data is collected in the background even when the panel is closed, so previews show real content the moment you open it.

### Quote Selection

Select text in any terminal and press `Cmd+Shift+Q` to quote it into the input bar. Each line gets prefixed with `> ` (Markdown blockquote style). The cursor lands after the quoted block so you can immediately type your reply or follow-up question.

### Input History

In the input bar, press `↑` to recall previous messages (per-session) and `↓` to go forward. Multi-line editing works naturally — history navigation only triggers on the first/last line of the textarea. Your in-progress input is preserved when you start browsing and restored when you return to the bottom.

### macOS Native

Full menu bar (Session, Edit, View, Window), native right-click context menus on sidebar items, window position/size persistence across restarts, and a resizable sidebar with drag handle.

## Requirements

- **macOS** (primary target — Linux/Windows may work but are untested)
- **Node.js** 18+
- **Claude Code CLI** installed and on your PATH:
  ```
  npm install -g @anthropic-ai/claude-code
  ```

## Getting Started

```bash
git clone <repo-url> claude-code-manager
cd claude-code-manager
npm install
```

To run in development mode (hot-reloading renderer + Electron):

```bash
# Terminal 1: Start the Vite dev server (fixed to port 5173)
npx vite

# Terminal 2: Compile the main process and launch Electron
npx tsc -p tsconfig.main.json
ELECTRON_RUN_AS_NODE= npx electron .
```

To use a different port:

```bash
# Terminal 1
npx vite --port 3000

# Terminal 2
VITE_PORT=3000 ELECTRON_RUN_AS_NODE= npx electron .
```

To build for production:

```bash
npm run build
ELECTRON_RUN_AS_NODE= npx electron .
```

> **Note:** If you use Claude Code's VS Code extension, your shell likely has `ELECTRON_RUN_AS_NODE=1` set. This breaks Electron's ability to load its own modules. You must unset it before launching: prefix the electron command with `ELECTRON_RUN_AS_NODE=` (set to empty). The dev scripts in `package.json` handle this automatically.

> **Note:** Vite is configured with `strictPort: true` — if port 5173 is already occupied, it will fail with an error instead of silently switching to another port. Kill the old process first: `kill $(lsof -ti:5173)`

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+T` | New session |
| `Cmd+W` | Close current tab |
| `Cmd+1` – `Cmd+9` | Switch to tab by index |
| `Cmd+F` | Focus sidebar search |
| `Cmd+,` | Open settings |
| `Cmd+E` | Toggle CLAUDE.md context panel |
| `Cmd+B` | Toggle sidebar |
| `Cmd+O` | Session Overview |
| `Cmd+R` | Redraw terminal |
| `Cmd+Shift+Q` | Quote selected terminal text into input |
| `Cmd+Shift+[` | Previous tab |
| `Cmd+Shift+]` | Next tab |
| `↑` / `↓` (in input) | Browse input history |

## Project Structure

```
src/
├── main/                  # Electron main process (Node.js)
│   ├── index.ts           # Window management, menu bar, IPC handlers, window state
│   ├── preload.ts         # contextBridge — exposes electronAPI to renderer
│   ├── pty.ts             # PTY manager — spawns/tracks claude processes via node-pty
│   ├── dialogue.ts        # DialogueManager — routes output between sessions
│   ├── sessions.ts        # Local session discovery — reads ~/.claude/ JSONL files
│   └── remote-sessions.ts # Remote session discovery + delete via SSH
│
├── renderer/              # React UI (bundled by Vite)
│   ├── App.tsx            # Root component — tabs, sidebar resize, menu event listeners
│   ├── main.tsx           # React entry point
│   ├── components/
│   │   ├── AboutDialog.tsx
│   │   ├── ContextPanel.tsx        # CLAUDE.md editor panel
│   │   ├── DialogueSetupModal.tsx  # Dialogue config: mode, sessions, roles, stop conditions
│   │   ├── DialogueView.tsx        # Dialogue transcript with controls
│   │   ├── EmptyState.tsx
│   │   ├── NewSessionModal.tsx     # New session (local or remote)
│   │   ├── OverviewPanel.tsx       # Cmd+O grid of live sessions with previews
│   │   ├── RawTerminal.tsx         # xterm.js wrapper with FitAddon + WebGL
│   │   ├── SessionView.tsx         # Terminal + input bar + context panel
│   │   ├── SettingsPanel.tsx       # General, Remote Hosts, Appearance, Defaults, Danger
│   │   ├── Sidebar.tsx             # Virtualized session list with All/Local/Remote filter
│   │   └── TabBar.tsx
│   ├── hooks/
│   │   ├── usePty.ts           # PTY lifecycle, output parsing, echo suppression
│   │   └── useSessions.ts      # Session list fetching
│   └── styles/
│       └── index.css            # Tailwind + custom scrollbar
│
└── shared/
    └── types.ts           # Shared TypeScript interfaces (SessionInfo, IPC API, etc.)
```

## How It Works

### Session Discovery

Claude Code stores conversation logs as JSONL files under `~/.claude/projects/`. Each project directory is named after its encoded filesystem path, and each session is a `<uuid>.jsonl` file inside it. The app reads these files on startup, extracts session metadata (ID, working directory, first user message, message count, last modified time), and populates the sidebar.

### PTY Relay

When you open a session, the main process spawns `claude --resume <session-id>` inside a `node-pty` pseudo-terminal, with the session's original working directory. PTY output streams to the renderer via `BrowserWindow.webContents.send()`, and keyboard input flows back via `ipcMain.on()`. Each session gets its own independent PTY instance — closing a tab kills its PTY, but switching tabs leaves background PTYs running.

### Output Parsing

Raw PTY output goes through several stages before reaching the chat panel:

1. **ANSI stripping** — CSI, OSC, DCS sequences and control characters are removed
2. **Boundary detection** — prompt lines (`>`, `❯`), box-drawing separators, and system lines (`Session resumed`, `Model:`) split the output into logical blocks
3. **Tool call detection** — lines matching Claude Code tool patterns (`Read`, `Bash`, `Edit`, etc.) are tagged as `role: 'tool'` with name and summary
4. **Echo suppression** — recently sent messages are tracked and deduplicated when the PTY echoes them back
5. **Idle detection** — after 500ms of silence, the session is marked as "waiting for input" and a final parse is triggered

The raw xterm.js terminal receives unprocessed PTY output, so nothing is lost.

### Dialogue Routing

The DialogueManager in the main process subscribes to PTY data events via a callback system. When a dialogue is active, it accumulates output from the current session, waits for idle (3s silence, or 1s if a prompt character is detected), then:

1. Strips ANSI escape codes (full ECMA-48 CSI coverage)
2. Strips Claude Code UI artifacts (box drawing, spinners, thinking animations, status bar text)
3. Records the clean text as a turn in the transcript
4. Checks stop conditions (max turns, keyword, PTY exit)
5. Forwards the text to the next session with an attribution prefix

A 1.5s delay after sending input skips the PTY echo and Claude Code's UI initialization before output collection begins.

## Roadmap

- [ ] PR review mode — paste a GitHub PR URL, auto-load the diff as context into a new session
- [ ] Full-text search across session message content
- [ ] Export conversation as Markdown
- [ ] Browse remote sessions list directly (currently lists are read on each launch via SSH)

## License

[Apache License 2.0](LICENSE)
