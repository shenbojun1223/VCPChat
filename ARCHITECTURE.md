# VCPChat — Architecture Document / 架构文档

> **Bilingual Edition · 双语版**
> English section first, Chinese section follows / 英文部分在前，中文部分在后

---

# PART I — ENGLISH

---

## 1. Project Purpose and Overview

### What is VCPChat?

**VCPChat** (v4.4.2) is an Electron-based AI-native desktop client that serves as the primary user interface for the VCP (Variable & Command Protocol) ecosystem. It is not merely a chat application — it is a **distributed AI operating system** that bridges desktop interaction, AI conversation, multimedia processing, and distributed task execution in a single platform.

### Relationship to VCPToolBox Backend

```
┌───────────────────────────────────────────────────┐
│                   VCPChat (this repo)              │
│         Electron Desktop Application               │
│   Chat UI · Desktop Widgets · Music · Canvas       │
└──────────────┬─────────────────┬──────────────────┘
               │ HTTP REST       │ WebSocket
               │ (Chat API)      │ (VCPLog)
               ▼                 ▼
┌───────────────────────────────────────────────────┐
│              VCPToolBox (backend)                   │
│     Middleware · Plugins · RAG · Vector DB          │
│   /v1/chat/completions   ws://host:6005             │
└───────────────────────────────────────────────────┘
```

- **VCPToolBox** is the backend middleware — it manages LLM routing, 300+ tool plugins, RAG retrieval, TagMemo memory, and distributed compute nodes.
- **VCPChat** is the frontend — it handles all user interaction, streaming rendering, local file management, audio playback, desktop widgets, and voice chat.
- Communication is over two channels:
  1. **HTTP REST** — `POST /v1/chat/completions` (OpenAI-compatible) for sending messages and receiving streamed responses.
  2. **WebSocket** — `ws://host:6005` for real-time log streaming, async task notifications, and tool approval flows.

### Core Capabilities

| Capability | Description |
|---|---|
| **AI Chat** | Multi-agent conversations with streaming rendering, tool-call visualization, and thought-chain display |
| **Group Chat** | Multiple AI agents conversing together in sequential, random, or invite-only modes |
| **Desktop System** | Full widget-based desktop with weather, system monitor, music player, news ticker, and AI-driven widgets |
| **Hi-Fi Music** | Rust-powered audio engine with DSD256 support, WASAPI exclusive mode, parametric EQ, convolver, spectrum analyzer |
| **Collaborative Canvas** | Real-time code/document editor with diff rendering, syntax highlighting, and AI simultaneous editing |
| **Memory Visualization** | Neural network graph of agent memories (TagMemo), with workbench for batch editing |
| **RAG Observer** | Real-time monitoring of backend RAG operations, tool executions, and async task progress |
| **Voice Chat** | Speech recognition + GPT-SoVITS text-to-speech with per-agent voice selection |
| **Notes System** | Hierarchical note-taking with tree view, markdown support, and full-text search |
| **Forum** | Multi-agent discussion forum for agent-to-agent collaborative problem solving |
| **Flow Lock** | Deep focus mode where AI proactively continues working without user input |
| **21+ Content Types** | Markdown, KaTeX, Mermaid, Three.js, Anime.js, Python (Pyodide), SVG, video, audio, PDF, and more |

### Technology Stack

| Layer | Technology |
|---|---|
| Desktop framework | Electron (Chromium + Node.js) |
| Audio engine | Rust (WASAPI, CPAL, custom DSP pipeline) |
| Assistant engine | Rust (screen capture, UI automation) |
| Rendering | marked.js, highlight.js, KaTeX, Mermaid, Three.js, Anime.js, Pyodide |
| TTS | GPT-SoVITS integration |
| File watching | Chokidar |
| Diff rendering | Google diff_match_patch, morphdom |
| Build / Package | electron-forge / electron-packager |

---

## 2. Directory Structure

```
vcpchat/
│
├── main.js                          # Electron main process entry point (1,363 LOC)
├── renderer.js                      # Renderer process initialization (1,926 LOC)
├── preload.js                       # Context bridge — security sandbox (533 LOC)
├── main.html                        # Main window HTML (custom title bar + layout)
├── splash.html                      # Native splash screen
├── style.css                        # Global stylesheet
├── package.json                     # Dependencies, scripts, build config (v4.4.2)
│
├── modules/                         # Core logic modules
│   ├── chatManager.js               # Chat session & message lifecycle
│   ├── messageRenderer.js           # Advanced streaming message render engine
│   ├── topicListManager.js          # Topic/conversation hierarchy
│   ├── itemListManager.js           # Agent/Group list UI
│   ├── settingsManager.js           # Settings UI and persistence
│   ├── fileManager.js               # File operations and attachments
│   ├── notificationRenderer.js      # Notification system
│   ├── emoticonManager.js           # Emoticon database and rendering
│   ├── filterManager.js             # Message filtering rules
│   ├── contextSanitizer.js          # Context normalization for API
│   ├── uiManager.js                 # UI state and transitions
│   ├── searchManager.js             # Global search across all data
│   ├── topicSummarizer.js           # Auto topic naming from messages
│   ├── modelUsageTracker.js         # Model selection and metrics
│   ├── SovitsTTS.js                 # Text-to-speech integration
│   ├── interruptHandler.js          # Message cancellation
│   ├── vcpClient.js                 # VCP backend HTTP communication
│   ├── weatherService.js            # Weather API integration
│   ├── webdavManager.js             # WebDAV for remote music
│   ├── lyricFetcher.js              # Lyric database integration
│   ├── speechRecognizer.js          # Web Speech API
│   ├── inputEnhancer.js             # Message input processing
│   ├── global-settings-manager.js   # Global settings coordination
│   ├── musicScannerWorker.js        # Background music library scanning
│   │
│   ├── renderer/                    # Renderer sub-system
│   │   ├── messageContextMenu.js    # Right-click operations
│   │   ├── domBuilder.js            # Efficient DOM skeleton creation
│   │   ├── contentProcessor.js      # HTML/Markdown/Mermaid processing
│   │   ├── streamManager.js         # Streaming diff updates (morphdom)
│   │   ├── imageHandler.js          # Image rendering and optimization
│   │   ├── animation.js             # Anime.js integration
│   │   ├── colorUtils.js            # Avatar color extraction
│   │   ├── enhancedColorUtils.js    # Advanced color manipulation
│   │   ├── emoticonUrlFixer.js      # AI emoticon URL repair
│   │   ├── visibilityOptimizer.js   # Virtual scrolling / lazy loading
│   │   └── middleClickHandler.js    # Middle-click quick actions
│   │
│   ├── ipc/                         # IPC handlers (main ↔ renderer)
│   │   ├── chatHandlers.js          # Chat history, topics, messages
│   │   ├── agentHandlers.js         # Agent CRUD and configuration
│   │   ├── groupChatHandlers.js     # Group chat operations
│   │   ├── assistantHandlers.js     # Selection listener / assistant
│   │   ├── canvasHandlers.js        # Collaborative editing windows
│   │   ├── desktopHandlers.js       # Desktop widget system (2,075 LOC)
│   │   ├── desktopRemoteHandlers.js # Desktop remote control (823 LOC)
│   │   ├── desktopMetrics.js        # System monitoring (1,198 LOC)
│   │   ├── musicHandlers.js         # Audio engine control (812 LOC)
│   │   ├── notesHandlers.js         # Notes management (781 LOC)
│   │   ├── ragHandlers.js           # RAG observer windows (473 LOC)
│   │   ├── promptHandlers.js        # System prompt/context management
│   │   ├── regexHandlers.js         # Regex rule application
│   │   ├── windowHandlers.js        # Window management (243 LOC)
│   │   ├── fileDialogHandlers.js    # File picker dialogs
│   │   ├── settingsHandlers.js      # Settings persistence
│   │   ├── themeHandlers.js         # Theme switching (215 LOC)
│   │   ├── diceHandlers.js          # Dice rolling plugin (175 LOC)
│   │   ├── emoticonHandlers.js      # Emoticon database
│   │   ├── forumHandlers.js         # Forum module
│   │   ├── memoHandlers.js          # Memo system
│   │   ├── sovitsHandlers.js        # TTS engine control
│   │   └── libreHardwareMonitorBridge.js # System info bridge
│   │
│   └── utils/
│       ├── agentConfigManager.js    # Agent configuration persistence
│       └── appSettingsManager.js    # Application settings management
│
├── styles/                          # CSS style system
│   ├── animations.css               # Animation library
│   ├── base.css                     # Base reset
│   ├── chat.css                     # Chat UI (30KB)
│   ├── components.css               # Reusable components (31KB)
│   ├── layout.css                   # Layout grid
│   ├── messageRenderer.css          # Message rendering (42KB)
│   ├── notifications.css            # Notifications
│   ├── search.css                   # Search UI
│   ├── settings.css                 # Settings panel
│   ├── themes.css                   # Theme variables
│   ├── setting/                     # Settings-specific styles
│   └── themes/                      # Custom theme definitions
│
├── Groupmodules/                    # Group chat system
│   ├── groupchat.js                 # Group chat orchestration
│   ├── grouprenderer.js             # Group settings UI rendering
│   ├── groupSettingsMarkup.js       # Settings form generation
│   ├── topicTitleManager.js         # Group topic management
│   └── modes/                       # Chat mode strategies
│       ├── baseChatMode.js          # Base strategy pattern
│       ├── sequentialMode.js        # Round-robin speaking
│       ├── natureRandomMode.js      # Context-aware @mention mode
│       └── inviteOnlyMode.js        # Manual invitation mode
│
├── Canvasmodules/                   # Collaborative editing
│   ├── canvas.js                    # Editor engine with diff rendering
│   ├── canvas.html                  # Canvas UI template
│   ├── canvas.css                   # Canvas styling
│   └── vendor/diff_match_patch.js   # Google diff algorithm
│
├── Voicechatmodules/                # Voice chat
│   ├── voicechat.js                 # Voice interface controller
│   ├── voicechat.html               # Voice UI template
│   ├── recognizer.html              # Speech recognition widget
│   └── voicechat.css                # Voice styling
│
├── Memomodules/                     # Memory visualization
│   ├── memo.js                      # Memory management
│   ├── memo-workbench.js            # Memory editing interface
│   ├── memo-graph.js                # Neural network graph visualization
│   ├── memo.html                    # Memory UI template
│   └── memo.css                     # Memory styling
│
├── RAGmodules/                      # RAG observation
│   ├── RAG_Observer.html            # Main RAG observer UI (97KB)
│   ├── RAG_Overlay.html             # Floating overlay (13KB)
│   └── rag-observer-config.js       # Configuration system
│
├── Desktopmodules/                  # Desktop widget system
│   ├── desktop.js                   # Main desktop controller
│   ├── desktop.html                 # Desktop template
│   ├── desktop.css                  # Desktop styling
│   ├── api/                         # API layer
│   │   ├── vcpProxy.js              # VCP API proxy
│   │   ├── ipcBridge.js             # IPC communication
│   │   └── desktopMetrics.js        # System metrics
│   ├── core/                        # Core systems
│   │   ├── widgetManager.js         # Widget lifecycle management
│   │   ├── dragSystem.js            # Drag-and-drop physics
│   │   ├── zIndexManager.js         # Z-order management
│   │   ├── visibilityFreezer.js     # Window state preservation
│   │   ├── wallpaperManager.js      # Dynamic wallpapers
│   │   ├── styleAutomation.js       # CSS automation
│   │   ├── statusIndicator.js       # Status UI
│   │   └── theme.js                 # Theme engine
│   ├── ui/                          # UI components
│   │   ├── dock.js                  # Task dock
│   │   ├── sidebar.js               # Sidebar navigation
│   │   ├── contextMenu.js           # Right-click menu
│   │   ├── globalSettings.js        # Settings modal
│   │   ├── saveModal.js             # Save dialog
│   │   └── iconPicker.js            # Icon selection
│   ├── builtinWidgets/              # Built-in widgets
│   │   ├── weatherWidget.js         # Weather display
│   │   ├── musicWidget.js           # Music player widget
│   │   ├── newsWidget.js            # News ticker
│   │   ├── systemMonitorWidget.js   # CPU/Memory/Network
│   │   ├── translateWidget.js       # Translation widget
│   │   ├── appTrayWidget.js         # Application launcher
│   │   └── vchatApps.js             # VChat integration
│   └── css/                         # Desktop-specific styles
│
├── Musicmodules/                    # Music player UI
├── Notemodules/                     # Note-taking system
├── Promptmodules/                   # System prompt management
├── Themesmodules/                   # Theme management
├── Translatormodules/               # Translation interface
├── Forummodules/                    # Multi-agent forum
│   ├── forum.js                     # Forum engine
│   ├── forum.html                   # Forum UI
│   └── forum.css                    # Forum styling
├── Flowlockmodules/                 # Flow lock (focus mode)
│   ├── flowlock.js                  # Flow lock engine
│   ├── flowlock.css                 # Flow lock UI
│   └── flowlock-integration.js      # Integration points
├── Dicemodules/                     # 3D dice rolling
│   ├── dice.js                      # Dice engine
│   ├── dice.html                    # Dice UI
│   └── assets/                      # Dice themes
│
├── rust_audio_engine/               # Rust Hi-Fi audio engine
│   └── src/
│       ├── main.rs                  # Entry point
│       ├── decoder.rs               # Audio decoding (MP3, FLAC, WAV, DSD)
│       ├── pipeline.rs              # Processing pipeline
│       ├── player/                  # Playback control
│       │   ├── audio_thread.rs      # Audio thread
│       │   ├── gapless.rs           # Gapless playback
│       │   └── spectrum.rs          # Spectrum analyzer
│       └── processor/               # DSP chain
│           ├── eq.rs                # Equalizer
│           ├── convolver.rs         # FIR convolver (IR)
│           ├── crossfeed.rs         # Crossfeed effect
│           ├── resampler.rs         # High-quality resampling
│           ├── dynamic_loudness.rs  # LUFS normalization
│           ├── saturation.rs        # Analog warmth
│           └── noise_shaper.rs      # Dithering
│
├── rust_assistant_engine/           # Rust desktop assistant engine
│   └── src/
│       ├── main.rs                  # Entry point
│       ├── capture.rs               # Screen capture
│       ├── windows_event_source.rs  # Windows event handling
│       └── metrics.rs               # Performance metrics
│
├── VCPDistributedServer/            # Local distributed server
│   └── Plugin/                      # Client-side plugins
│       ├── BladeGame/               # Game plugin
│       ├── PTYShellExecutor/        # Shell execution
│       ├── VCPEverything/           # File search (Everything)
│       ├── TableLampRemote/         # Smart lamp IoT control
│       └── [more plugins...]
│
├── VCPHumanToolBox/                 # Human workflow tools
│   ├── ComfyUImodules/              # ComfyUI integration
│   └── WorkflowEditormodules/       # Workflow designer
│
├── VchatManager/                    # Chat history manager
├── audio_engine/                    # Audio engine binaries + IR presets
├── assets/                          # Icons, fonts, SVGs, wallpapers
├── vendor/                          # Bundled fonts, LibreHardwareMonitor
├── migration/                       # Data migration scripts
├── NativeSpalash/                   # Native splash screen source
└── SovitsTest/                      # TTS engine testing
```

---

## 3. Key Components and Their Roles

### 3.1 Electron Architecture

VCPChat follows the standard Electron three-process model with strict security isolation:

```
┌──────────────────────────────────────────────────────┐
│                Main Process (main.js)                  │
│  • Window management (BrowserWindow lifecycle)         │
│  • File system access (all disk I/O)                   │
│  • IPC message broker (ipcMain handlers)               │
│  • Child process spawning (Rust engines)               │
│  • Audio engine lifecycle                              │
│  • WebSocket client (VCPLog)                           │
│  • System tray integration                             │
│  • Global hotkey registration                          │
└──────────────┬──────────────────┬─────────────────────┘
               │  contextBridge    │
               │  (preload.js)     │
    ┌──────────▼──────┐  ┌────────▼──────┐  ┌───────────┐
    │ Renderer Process │  │ RAG Observer  │  │ Desktop   │
    │ (main.html)      │  │ Window        │  │ Window    │
    │ Chat UI          │  │ RAG_Observer  │  │ desktop   │
    │ Settings         │  │ .html         │  │ .html     │
    │ Sidebar          │  └───────────────┘  └───────────┘
    └─────────────────┘
```

**Security model (preload.js):**
- `nodeIntegration: false` — renderer cannot access Node.js.
- `contextIsolation: true` — no shared objects between main and renderer.
- All system access goes through `contextBridge.exposeInMainWorld`.
- Explicit IPC channel whitelist — no wildcard channels.

### 3.2 `main.js` — Main Process

- Initializes the Electron app with single-instance lock.
- Creates the main BrowserWindow (custom frameless title bar).
- Loads and registers all IPC handler modules from `modules/ipc/`.
- Starts the Rust audio engine as a child process.
- Connects to VCPToolBox via WebSocket for log streaming.
- Watches chat history files via Chokidar for external edits (enables multi-client sync).
- Manages data directory structure:

```
AppData/ (project root)
├── Agents/{agentId}/config.json
├── AgentGroups/{groupId}/config.json
├── UserData/
│   ├── {agentId}/topics/{topicId}/history.json
│   ├── attachments/{id}.png
│   └── user_avatar.png
├── Notemodules/ (user notes tree)
├── settings.json
├── songlist.json
├── MusicCoverCache/
├── ResampleCache/
└── canvas/
```

### 3.3 `renderer.js` — Renderer Initialization

- Bootstraps all renderer-side managers: chatManager, messageRenderer, settingsManager, searchManager, etc.
- Sets up event listeners for UI interactions.
- Initializes theme system from saved settings.
- Loads agent list and populates sidebar.

### 3.4 `modules/chatManager.js` — Chat Session Manager

- Manages the complete message lifecycle: compose → validate → send → stream → render → persist.
- Handles message editing, deletion, regeneration, and branching.
- Coordinates with `interruptHandler.js` for message cancellation.
- Tracks per-topic metadata (timestamps, unread counts, locks).

### 3.5 `modules/messageRenderer.js` — Streaming Render Engine

The most complex rendering pipeline, supporting 21+ content types:

```
Input (SSE stream chunks)
    ↓
[1] Protect LaTeX blocks (prevent Markdown parser interference)
    ↓
[2] Extract special blocks: <<<[TOOL_REQUEST]>>>, <<<[DESKTOP_PUSH]>>>,
    <thinking>, [[VCP调用结果...]]
    ↓
[3] marked.js → Markdown to HTML
    ↓
[4] Restore protected LaTeX blocks
    ↓
[5] highlight.js → Code syntax highlighting
    ↓
[6] KaTeX → Math equation rendering
    ↓
[7] Image optimization (sharp.js: thumbnail/display/full)
    ↓
[8] Mermaid → Flowcharts, sequence diagrams
    ↓
[9] Anime.js → CSS/SVG animations
    ↓
[10] Three.js → 3D canvas rendering
    ↓
[11] Custom DIV → Agent theme bubbles
    ↓
[12] Create message bubble DOM node
    ↓
[13] Append to chat with entry animation
    ↓
[14] Setup listeners (context menu, TTS, copy, etc.)
```

### 3.6 `modules/vcpClient.js` — Backend Communication

- Makes HTTP POST requests to the VCPToolBox `/v1/chat/completions` endpoint.
- Manages active request map with AbortController for interruption.
- Auto-injects context into system messages:
  - Music playlist and currently-playing track (if enabled).
  - Agent bubble theme rendering instructions.
  - Desktop state information.
- Supports two endpoint modes:
  - Standard: `/v1/chat/completions`
  - Tool injection: `/v1/chatvcp/completions` (when `enableVcpToolInjection` is on).

### 3.7 `Groupmodules/` — Group Chat System

Three chat modes using the Strategy pattern:

| Mode | Behavior |
|---|---|
| **Sequential** | Agents speak in predefined order (round-robin) |
| **Nature Random** | @mentions and keyword matching trigger specific agents; context weights determine speaker |
| **Invite-Only** | User manually selects which agent speaks next |

### 3.8 `Desktopmodules/` — Desktop Widget System

A full desktop environment inside a separate Electron window:
- **widgetManager.js** — Widget lifecycle (create, persist, destroy, serialize state).
- **dragSystem.js** — Physics-based drag-and-drop.
- **wallpaperManager.js** — Static and dynamic animated wallpapers.
- **Built-in widgets** — Weather, music controls, system monitor (CPU/RAM/network), news ticker, translator, app launcher.
- **AI-driven widgets** — The LLM can push widgets to the desktop via `<<<[DESKTOP_PUSH]>>>` blocks.

### 3.9 `rust_audio_engine/` — Hi-Fi Audio Engine

A Rust-based audio engine with professional-grade DSP:

```
Input → Decoder (MP3/FLAC/WAV/OGG/AAC/DSD256)
      → Resampler (polyphase, high-quality)
      → EQ (IIR cascade parametric filters)
      → FIR Convolver (impulse response / room correction)
      → Crossfeed (headphone spatialization)
      → Dynamic Loudness (LUFS normalization)
      → Saturation (analog warmth modeling)
      → Noise Shaper (dithering for bit-depth reduction)
      → Output (WASAPI Exclusive / shared mode)
```

- 64-bit floating point throughout the chain.
- WASAPI Exclusive Mode for bit-perfect output (Windows).
- Gapless playback for album listening.
- Real-time spectrum analyzer.
- SIMD acceleration.

### 3.10 `Memomodules/` — Memory Visualization

- **memo-graph.js** — Force-directed graph of memory nodes and semantic relationships.
- **memo-workbench.js** — Batch editing interface for tagging, merging, and summarizing memories.
- Connects to the backend's TagMemo V6 system to visualize agent knowledge.

### 3.11 `RAGmodules/` — RAG Observer

- **RAG_Observer.html** — Full-screen window showing real-time VCPToolBox logs, tool executions, async task progress, and agent thought chains.
- **RAG_Overlay.html** — Floating always-on-top notification bubble for tool approval actions.

### 3.12 `Flowlockmodules/` — Focus Mode

Enables AI proactive messaging — the agent continues working without waiting for user input:
- Configurable cooldown timer.
- Custom trigger prompt.
- Topic-locked (prevents switching away).
- Can be enabled/disabled by both user and AI.

---

## 4. Backend Communication (API & WebSocket)

### 4.1 HTTP REST — Chat API

**Primary endpoint:** `POST http://{host}:6005/v1/chat/completions`

```json
{
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "stream": true,
  "model": "model_name",
  "temperature": 0.7,
  "max_tokens": 2000,
  "requestId": "unique_message_id"
}
```

Response: Server-Sent Events (SSE) stream of delta chunks, identical to OpenAI format.

**Alternative endpoint:** `POST http://{host}:6005/v1/chatvcp/completions`
— Used when `enableVcpToolInjection` is enabled in settings, activates backend tool injection.

### 4.2 WebSocket — VCPLog

**Connection:** `ws://{host}:6005`

Used for:
- Real-time log streaming (tool calls, errors, debug info).
- Async task completion notifications.
- Tool approval request/response flow.
- RAG observer data feed.

**IPC events:**
| Event | Direction | Purpose |
|---|---|---|
| `connect-vcplog` | renderer → main | Start WebSocket connection |
| `disconnect-vcplog` | renderer → main | Stop WebSocket connection |
| `vcp-log-message` | main → renderer | Log event received |
| `send-vcplog-message` | renderer → main | Send message to backend |

### 4.3 Streaming Message Flow

```
User types message + clicks Send
         ↓
chatManager.js validates & builds context
  (system prompt + history + attachments + regex rules)
         ↓
IPC invoke: "send-to-vcp" → main process
         ↓
vcpClient.js:
  - Injects music/desktop context
  - Creates AbortController
  - HTTP POST with SSE streaming
         ↓
Backend streams SSE chunks
         ↓
Main process forwards via IPC:
  "vcp-stream-chunk" → delta text
  "vcp-stream-event" → metadata (start, tool_call, end)
         ↓
Renderer:
  messageRenderer aggregates chunks
  streamManager applies diff updates (morphdom)
  contentProcessor renders special blocks
         ↓
Message bubble updates in real-time with streaming animation
```

### 4.4 Tool Call & Async Task Flow

```
1. AI response contains: <<<[TOOL_REQUEST]>>>{"tool":"..."}<<<[END_TOOL_REQUEST]>>>
2. Frontend renders: collapsible tool-call bubble with parameters
3. Backend executes tool (may take seconds to hours)
4. Progress updates arrive via WebSocket (vcp-log-message)
5. Completion: result inserted into chat via diff rendering
6. User sees both request bubble and result bubble
```

### 4.5 Complete IPC Channel Reference

#### Settings & Configuration
| Channel | Direction | Purpose |
|---|---|---|
| `load-settings` | invoke | Fetch global settings.json |
| `save-settings` | invoke | Persist settings |
| `save-user-avatar` | invoke | Upload user avatar |

#### Agent Management
| Channel | Direction | Purpose |
|---|---|---|
| `get-agents` | invoke | List all agents |
| `get-agent-config` | invoke | Fetch agent configuration |
| `save-agent-config` | invoke | Update agent |
| `create-agent` | invoke | Create new agent |
| `delete-agent` | invoke | Remove agent |
| `select-avatar` / `save-avatar` | invoke | Avatar management |
| `get-cached-models` / `get-hot-models` | invoke | Available models |
| `save-agent-order` | invoke | Drag reorder agents |

#### Topic Management
| Channel | Direction | Purpose |
|---|---|---|
| `get-agent-topics` | invoke | List topics for agent |
| `create-new-topic-for-agent` | invoke | Create topic |
| `save-agent-topic-title` | invoke | Rename topic |
| `delete-topic` | invoke | Delete topic |
| `toggle-topic-lock` | invoke | Lock/unlock |
| `search-topics-by-content` | invoke | Search across topics |

#### Chat History
| Channel | Direction | Purpose |
|---|---|---|
| `get-chat-history` | invoke | Load messages |
| `save-chat-history` | invoke | Persist messages |
| `history-file-updated` | on | External file changes (Chokidar) |

#### VCP Communication
| Channel | Direction | Purpose |
|---|---|---|
| `send-to-vcp` | invoke | Send chat request to backend |
| `vcp-stream-chunk` | on | Receive text delta |
| `vcp-stream-event` | on | Receive metadata event |
| `interrupt-vcp-request` | invoke | Cancel in-flight request |

#### Group Chat
| Channel | Direction | Purpose |
|---|---|---|
| `create-agent-group` | invoke | Create group |
| `get-agent-groups` | invoke | List groups |
| `send-group-chat-message` | invoke | Send to group |
| `inviteAgentToSpeak` | invoke | Invite mode trigger |
| `interrupt-group-request` | invoke | Cancel group message |

#### Music
| Channel | Direction | Purpose |
|---|---|---|
| `music-load` / `music-play` / `music-pause` | invoke | Playback control |
| `music-seek` | invoke | Seek position |
| `music-set-volume` | invoke | Volume control |
| `music-set-eq` | invoke | Equalizer settings |
| `music-configure-resampling` | invoke | Upsampling config |
| `music-get-lyrics` / `music-fetch-lyrics` | invoke | Lyrics management |

#### Desktop / Canvas / Notes / RAG
| Channel | Direction | Purpose |
|---|---|---|
| `open-desktop-window` | invoke | Launch desktop |
| `desktop-push-widget` | on | AI pushes widget |
| `open-canvas-window` | invoke | Open canvas editor |
| `read-notes-tree` / `write-txt-note` | invoke | Notes CRUD |
| `open-rag-observer-window` | invoke | Launch RAG observer |
| `rag-overlay-show` / `rag-overlay-hide` | send | Overlay control |

#### Window Control
| Channel | Direction | Purpose |
|---|---|---|
| `minimize-window` / `maximize-window` / `close-window` | send | Window management |
| `open-dev-tools` | send | Open DevTools |

---

## 5. UI Structure and Main Screens

### 5.1 Main Window Layout

```
┌──────────────────────────────────────────────────────────┐
│ ◀━━━━━━━━━ Custom Title Bar ━━━━━━━━━━▶   ⚙️  □  ❌     │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────────────┐ ┌────────────┐│
│ │   Sidebar     │ │     Chat Area        │ │ Notif.     ││
│ │              │ │                      │ │ Sidebar    ││
│ │  [Agents]    │ │  Message Bubbles     │ │            ││
│ │  [Groups]    │ │  (streaming render)  │ │  VCPLog    ││
│ │              │ │                      │ │  Tasks     ││
│ │  ─────────── │ │                      │ │  Alerts    ││
│ │  [Topics]    │ │                      │ │            ││
│ │  + New Topic │ │  ┌────────────────┐  │ │            ││
│ │              │ │  │  Input Box     │  │ │            ││
│ │              │ │  │  [Attachments] │  │ │            ││
│ │              │ │  │  [Send]        │  │ │            ││
│ └──────────────┘ └──┴────────────────┴──┘ └────────────┘│
│ ◀─ resizable ─▶  ◀───── flex chat ─────▶  ◀─resizable─▶│
└──────────────────────────────────────────────────────────┘
```

### 5.2 Sidebar — Two Tabs

**Tab 1: Topics**
- Search input field
- Topic list with unread badges
- Contextual to selected agent/group
- Actions: new topic, delete, export, lock

**Tab 2: Settings**
- Agent/group configuration editor
- System prompt editor with syntax highlighting
- Model selection dropdown (cached + hot models)
- Temperature / max tokens / context length sliders
- Avatar upload
- Regex rules GUI editor
- Flow lock configuration
- Music control toggle

### 5.3 Chat Area

- Streaming message bubbles with typing animation
- Message types: text, code (highlighted), math (KaTeX), diagrams (Mermaid), 3D (Three.js), animations (Anime.js), images, videos, audio, tool calls (collapsible), thought chains (expandable)
- Virtual scrolling for performance (visibilityOptimizer.js)
- Right-click context menu: copy, edit, forward, delete, save to notes
- File attachment bar: drag-drop, paste, file dialog
- Input box with markdown preview and @mention support

### 5.4 Secondary Windows

| Window | Purpose |
|---|---|
| **Desktop** | Full widget desktop environment with dock, sidebar, drag-drop widgets |
| **Canvas** | Collaborative code/document editor with diff rendering and code execution |
| **RAG Observer** | Real-time backend operation monitor |
| **RAG Overlay** | Always-on-top floating notification for tool approvals |
| **Voice Chat** | Speech recognition and TTS interface |
| **Memo** | Memory graph visualization and workbench |
| **Forum** | Multi-agent discussion forum |
| **Notes** | Hierarchical note-taking with tree view |
| **Dice** | 3D physics-based dice roller |
| **Translator** | Translation interface |

---

## 6. Extension and Customization Points

### 6.1 Themes

**Location:** `/styles/themes/` + `/Themesmodules/`

Create custom theme files with CSS variable overrides:
```json
{
  "name": "Custom Theme",
  "colors": {
    "primary": "#3498db",
    "background": "#1e1e1e",
    "accent": "#e74c3c"
  },
  "fonts": { "default": "Roboto", "code": "Fira Code" },
  "bubbleStyle": {
    "userBubbleCSS": "...",
    "agentBubbleCSS": "...",
    "animationKeyframes": "..."
  }
}
```

### 6.2 Custom Content Renderers

Add support for new content types in `modules/renderer/contentProcessor.js`:
```javascript
// Add to ADVANCED_RENDER_MAP:
'my-custom-type': (content) => {
  return `<div class="custom">${content}</div>`;
}
```

### 6.3 Desktop Widgets

**Location:** `/Desktopmodules/builtinWidgets/`

Create a new widget by exporting:
```javascript
export default {
  init(config) { /* setup */ },
  render() { /* return HTML string */ },
  destroy() { /* cleanup */ },
  getState() { /* serializable state */ },
  setState(state) { /* restore state */ }
}
```

### 6.4 Distributed Server Plugins

**Location:** `/VCPDistributedServer/Plugin/`

Each plugin has:
- `plugin.js` — Main implementation
- `manifest.json` — Metadata and capability declaration
- Auto-discovered at startup, callable by AI via the tool system.

### 6.5 Regex Rules (Per-Agent)

Configure via Settings → Agent → Regex Rules:
```json
{
  "findPattern": "/regex/gi",
  "replaceWith": "replacement",
  "applyToContext": true,
  "applyToFrontend": false,
  "applyToRoles": ["assistant"],
  "minDepth": 0,
  "maxDepth": -1
}
```
- **Context scope** — applied before sending to VCP backend.
- **Frontend scope** — applied to incoming messages for display.

### 6.6 Agent Configuration

Each agent in `/Agents/{id}/config.json` supports:
```json
{
  "name": "Agent Name",
  "model": "model_id",
  "systemPrompt": "You are...",
  "temperature": 0.7,
  "maxTokens": 2000,
  "contextTokens": 4000,
  "avatar": "base64_or_path",
  "regexRules": [],
  "promptMode": "preset|custom",
  "musicControl": false,
  "flowLockSettings": {
    "enabled": false,
    "prompt": "Continue...",
    "cooldown": 5000
  }
}
```

### 6.7 Group Chat Modes

Extend with new strategies by implementing the base pattern in `/Groupmodules/modes/baseChatMode.js`:
```javascript
class MyCustomMode extends BaseChatMode {
  async selectNextSpeaker(context) { /* your logic */ }
  async generateResponse(agent, messages) { /* your logic */ }
}
```

### 6.8 Global Settings

Edit `settings.json` directly or use the UI:
```json
{
  "vcpServerUrl": "http://localhost:6005/v1/chat/completions",
  "vcpLogUrl": "ws://localhost:6005",
  "vcpApiKey": "your-api-key",
  "enableVcpToolInjection": true,
  "agentMusicControl": true,
  "enableAgentBubbleTheme": true,
  "theme": "dark",
  "language": "zh-CN"
}
```

---

---

# 第二部分 — 中文

---

## 1. 项目目的与概述

### VCPChat 是什么？

**VCPChat**（v4.4.2）是一款基于 Electron 的 AI 原生桌面客户端，作为 VCP（变量与命令协议）生态系统的主要用户界面。它不仅仅是一个聊天应用——它是一个**分布式 AI 操作系统**，将桌面交互、AI 对话、多媒体处理和分布式任务执行集成在单一平台中。

### 与 VCPToolBox 后端的关系

```
┌───────────────────────────────────────────────────┐
│                VCPChat（本仓库）                     │
│          Electron 桌面应用程序                       │
│   聊天 UI · 桌面小组件 · 音乐 · 协作画布              │
└──────────────┬─────────────────┬──────────────────┘
               │ HTTP REST       │ WebSocket
               │（聊天 API）      │（VCPLog）
               ▼                 ▼
┌───────────────────────────────────────────────────┐
│              VCPToolBox（后端）                      │
│     中间件 · 插件 · RAG · 向量数据库                  │
│   /v1/chat/completions   ws://host:6005             │
└───────────────────────────────────────────────────┘
```

- **VCPToolBox** 是后端中间件——管理 LLM 路由、300+ 工具插件、RAG 检索、TagMemo 记忆和分布式计算节点。
- **VCPChat** 是前端——处理所有用户交互、流式渲染、本地文件管理、音频播放、桌面小组件和语音聊天。
- 通信使用两个通道：
  1. **HTTP REST** — `POST /v1/chat/completions`（OpenAI 兼容）用于发送消息和接收流式响应。
  2. **WebSocket** — `ws://host:6005` 用于实时日志流、异步任务通知和工具审批流程。

### 核心能力

| 能力 | 描述 |
|---|---|
| **AI 聊天** | 多 Agent 对话，流式渲染，工具调用可视化，思维链展示 |
| **群聊** | 多 AI Agent 协同对话，支持顺序、随机、邀请三种模式 |
| **桌面系统** | 完整小组件桌面：天气、系统监控、音乐播放器、新闻、AI 驱动小组件 |
| **Hi-Fi 音乐** | Rust 驱动音频引擎，DSD256 支持，WASAPI 独占模式，参数 EQ，卷积器，频谱分析 |
| **协作画布** | 实时代码/文档编辑器，差异渲染，语法高亮，AI 同时编辑 |
| **记忆可视化** | Agent 记忆的神经网络图（TagMemo），含批量编辑工作台 |
| **RAG 观察器** | 实时监控后端 RAG 操作、工具执行和异步任务进度 |
| **语音聊天** | 语音识别 + GPT-SoVITS 文字转语音，每个 Agent 独立音色 |
| **笔记系统** | 层级笔记，树形视图，Markdown 支持，全文搜索 |
| **论坛** | 多 Agent 讨论论坛，Agent 间协作解决问题 |
| **专注锁** | 深度专注模式，AI 主动持续工作无需用户输入 |
| **21+ 内容类型** | Markdown、KaTeX、Mermaid、Three.js、Anime.js、Python（Pyodide）、SVG、视频、音频、PDF 等 |

### 技术栈

| 层次 | 技术 |
|---|---|
| 桌面框架 | Electron（Chromium + Node.js）|
| 音频引擎 | Rust（WASAPI、CPAL、自定义 DSP 管线）|
| 助手引擎 | Rust（屏幕捕获、UI 自动化）|
| 渲染 | marked.js、highlight.js、KaTeX、Mermaid、Three.js、Anime.js、Pyodide |
| TTS | GPT-SoVITS 集成 |
| 文件监视 | Chokidar |
| 差异渲染 | Google diff_match_patch、morphdom |
| 构建 / 打包 | electron-forge / electron-packager |

---

## 2. 目录结构

```
vcpchat/
│
├── main.js                          # Electron 主进程入口（1,363 行）
├── renderer.js                      # 渲染进程初始化（1,926 行）
├── preload.js                       # 上下文桥接——安全沙箱（533 行）
├── main.html                        # 主窗口 HTML（自定义标题栏 + 布局）
├── splash.html                      # 原生启动画面
├── style.css                        # 全局样式表
├── package.json                     # 依赖、脚本、构建配置（v4.4.2）
│
├── modules/                         # 核心逻辑模块
│   ├── chatManager.js               # 聊天会话与消息生命周期
│   ├── messageRenderer.js           # 高级流式消息渲染引擎
│   ├── vcpClient.js                 # VCP 后端 HTTP 通信
│   ├── renderer/                    # 渲染子系统
│   │   ├── contentProcessor.js      # HTML/Markdown/Mermaid 处理
│   │   ├── streamManager.js         # 流式差异更新（morphdom）
│   │   ├── visibilityOptimizer.js   # 虚拟滚动/懒加载
│   │   └── [更多渲染模块...]
│   ├── ipc/                         # IPC 处理器（主进程 ↔ 渲染进程）
│   │   ├── chatHandlers.js          # 聊天历史、话题、消息
│   │   ├── desktopHandlers.js       # 桌面小组件系统（2,075 行）
│   │   ├── musicHandlers.js         # 音频引擎控制（812 行）
│   │   └── [更多 IPC 处理器...]
│   └── utils/                       # 工具模块
│
├── styles/                          # CSS 样式系统
│   ├── messageRenderer.css          # 消息渲染样式（42KB）
│   ├── components.css               # 可复用组件（31KB）
│   └── themes/                      # 自定义主题定义
│
├── Groupmodules/                    # 群聊系统
│   └── modes/                       # 聊天模式策略
│       ├── sequentialMode.js        # 轮流发言
│       ├── natureRandomMode.js      # 上下文感知随机模式
│       └── inviteOnlyMode.js        # 手动邀请模式
│
├── Canvasmodules/                   # 协作编辑
├── Voicechatmodules/                # 语音聊天
├── Memomodules/                     # 记忆可视化
├── RAGmodules/                      # RAG 观察
├── Desktopmodules/                  # 桌面小组件系统
│   ├── core/                        # 核心系统（小组件管理、拖拽、壁纸）
│   ├── builtinWidgets/              # 内置小组件（天气、音乐、系统监控等）
│   └── ui/                          # UI 组件（Dock、侧栏、上下文菜单）
│
├── rust_audio_engine/               # Rust Hi-Fi 音频引擎
│   └── src/processor/               # DSP 链（EQ、卷积器、交叉馈送、响度等）
│
├── rust_assistant_engine/           # Rust 桌面助手引擎（屏幕捕获、UI 自动化）
├── VCPDistributedServer/Plugin/     # 客户端分布式插件
├── VCPHumanToolBox/                 # 人类工作流工具
└── assets/                          # 图标、字体、SVG、壁纸
```

---

## 3. 核心组件与职责

### 3.1 Electron 架构

```
┌──────────────────────────────────────────────────────┐
│                 主进程（main.js）                       │
│  • 窗口管理（BrowserWindow 生命周期）                   │
│  • 文件系统访问（所有磁盘 I/O）                         │
│  • IPC 消息代理（ipcMain 处理器）                       │
│  • 子进程管理（Rust 引擎）                              │
│  • WebSocket 客户端（VCPLog）                           │
└──────────────┬──────────────────┬─────────────────────┘
               │  contextBridge    │
               │ （preload.js）     │
    ┌──────────▼──────┐  ┌────────▼──────┐  ┌───────────┐
    │  渲染进程        │  │ RAG 观察器    │  │  桌面      │
    │ （main.html）    │  │  窗口         │  │  窗口      │
    │  聊天 UI        │  │              │  │            │
    └─────────────────┘  └───────────────┘  └───────────┘
```

**安全模型（preload.js）：**
- `nodeIntegration: false` — 渲染进程无法访问 Node.js。
- `contextIsolation: true` — 主进程与渲染进程无共享对象。
- 所有系统访问通过 `contextBridge.exposeInMainWorld`。
- 显式 IPC 通道白名单——无通配符通道。

### 3.2 消息渲染管线（messageRenderer.js）

支持 21+ 种内容类型的最复杂渲染管线：

```
输入（SSE 流式块）
    ↓
[1] 保护 LaTeX 块（防止 Markdown 解析器干扰）
    ↓
[2] 提取特殊块：<<<[TOOL_REQUEST]>>>、<<<[DESKTOP_PUSH]>>>、
    <thinking>、[[VCP调用结果...]]
    ↓
[3] marked.js → Markdown 转 HTML
    ↓
[4] 恢复受保护的 LaTeX 块
    ↓
[5] highlight.js → 代码语法高亮
    ↓
[6] KaTeX → 数学公式渲染
    ↓
[7] 图像优化（sharp.js：缩略图/显示/原图）
    ↓
[8] Mermaid → 流程图、时序图
    ↓
[9] Anime.js → CSS/SVG 动画
    ↓
[10] Three.js → 3D 画布渲染
    ↓
[11] 自定义 DIV → Agent 主题气泡
    ↓
[12] 创建消息气泡 DOM 节点
    ↓
[13] 以入场动画追加到聊天区
    ↓
[14] 设置监听器（上下文菜单、TTS、复制等）
```

### 3.3 后端通信（vcpClient.js）

- 向 VCPToolBox `/v1/chat/completions` 端点发起 HTTP POST 请求。
- 使用 AbortController 管理活跃请求映射，支持中断。
- 自动注入上下文到系统消息中：
  - 音乐播放列表和当前播放曲目。
  - Agent 气泡主题渲染指令。
  - 桌面状态信息。

### 3.4 Rust 音频引擎

```
输入 → 解码器（MP3/FLAC/WAV/OGG/AAC/DSD256）
     → 重采样器（多相、高质量）
     → EQ（IIR 级联参数滤波器）
     → FIR 卷积器（脉冲响应/房间校正）
     → 交叉馈送（耳机空间化）
     → 动态响度（LUFS 归一化）
     → 饱和度（模拟温暖建模）
     → 噪声整形（抖动）
     → 输出（WASAPI 独占/共享模式）
```

---

## 4. 后端通信（API 与 WebSocket）

### 4.1 HTTP REST — 聊天 API

**主端点：** `POST http://{host}:6005/v1/chat/completions`

请求格式（OpenAI 兼容）：
```json
{
  "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],
  "stream": true,
  "model": "model_name",
  "temperature": 0.7,
  "max_tokens": 2000,
  "requestId": "unique_message_id"
}
```

### 4.2 WebSocket — VCPLog

**连接地址：** `ws://{host}:6005`

用途：
- 实时日志流（工具调用、错误、调试信息）
- 异步任务完成通知
- 工具审批请求/响应流程
- RAG 观察器数据馈送

### 4.3 流式消息流程

```
用户输入消息 + 点击发送
         ↓
chatManager.js 验证并构建上下文
 （系统提示 + 历史 + 附件 + 正则规则）
         ↓
IPC invoke: "send-to-vcp" → 主进程
         ↓
vcpClient.js:
  - 注入音乐/桌面上下文
  - 创建 AbortController
  - SSE 流式 HTTP POST
         ↓
后端流式传输 SSE 块
         ↓
主进程通过 IPC 转发:
  "vcp-stream-chunk" → 增量文本
  "vcp-stream-event" → 元数据（开始、工具调用、结束）
         ↓
渲染进程:
  messageRenderer 聚合块
  streamManager 应用差异更新（morphdom）
  contentProcessor 渲染特殊块
         ↓
消息气泡以流式动画实时更新
```

### 4.4 IPC 通道参考

| 类别 | 关键通道 | 用途 |
|---|---|---|
| 设置 | `load-settings`、`save-settings` | 全局设置读写 |
| Agent | `get-agents`、`create-agent`、`save-agent-config` | Agent CRUD |
| 话题 | `get-agent-topics`、`create-new-topic-for-agent` | 话题管理 |
| 聊天 | `get-chat-history`、`save-chat-history` | 历史记录持久化 |
| VCP | `send-to-vcp`、`vcp-stream-chunk`、`interrupt-vcp-request` | 后端通信 |
| 群聊 | `send-group-chat-message`、`inviteAgentToSpeak` | 群聊操作 |
| 音乐 | `music-load`、`music-play`、`music-set-eq` | 音频引擎控制 |
| 桌面 | `open-desktop-window`、`desktop-push-widget` | 小组件系统 |
| 画布 | `open-canvas-window`、`save-canvas` | 协作编辑 |
| 笔记 | `read-notes-tree`、`write-txt-note` | 笔记 CRUD |
| RAG | `open-rag-observer-window`、`rag-overlay-show` | RAG 观察 |
| 窗口 | `minimize-window`、`maximize-window`、`close-window` | 窗口控制 |

---

## 5. UI 结构与主要界面

### 5.1 主窗口布局

```
┌──────────────────────────────────────────────────────────┐
│ ◀━━━━━━━━━ 自定义标题栏 ━━━━━━━━━━▶      ⚙️  □  ❌      │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────────────┐ ┌────────────┐│
│ │   侧边栏      │ │     聊天区域          │ │ 通知侧栏   ││
│ │              │ │                      │ │            ││
│ │  [Agent 列表] │ │  消息气泡             │ │  VCPLog    ││
│ │  [群组列表]   │ │  （流式渲染）          │ │  任务      ││
│ │              │ │                      │ │  警报      ││
│ │  ─────────── │ │                      │ │            ││
│ │  [话题列表]   │ │                      │ │            ││
│ │  + 新话题     │ │  ┌────────────────┐  │ │            ││
│ │              │ │  │  输入框         │  │ │            ││
│ │              │ │  │  [附件] [发送]   │  │ │            ││
│ └──────────────┘ └──┴────────────────┴──┘ └────────────┘│
│ ◀── 可调 ──▶    ◀──── 弹性聊天 ────▶     ◀── 可调 ──▶  │
└──────────────────────────────────────────────────────────┘
```

### 5.2 辅助窗口

| 窗口 | 用途 |
|---|---|
| **桌面** | 完整小组件桌面环境：Dock、侧栏、拖拽小组件 |
| **画布** | 协作代码/文档编辑器，差异渲染和代码执行 |
| **RAG 观察器** | 实时后端操作监控 |
| **RAG 浮窗** | 常驻顶层浮动通知，用于工具审批 |
| **语音聊天** | 语音识别和 TTS 界面 |
| **记忆** | 记忆图谱可视化和工作台 |
| **论坛** | 多 Agent 讨论论坛 |
| **笔记** | 层级笔记，树形视图 |
| **骰子** | 3D 物理骰子 |
| **翻译** | 翻译界面 |

---

## 6. 扩展与自定义点

### 6.1 自定义主题

**位置：** `/styles/themes/` + `/Themesmodules/`

创建包含 CSS 变量覆盖的自定义主题文件，定义颜色、字体和气泡样式。

### 6.2 自定义内容渲染器

在 `modules/renderer/contentProcessor.js` 的 `ADVANCED_RENDER_MAP` 中添加新内容类型支持。

### 6.3 桌面小组件

**位置：** `/Desktopmodules/builtinWidgets/`

导出 `init()`、`render()`、`destroy()`、`getState()`、`setState()` 方法即可创建新小组件。

### 6.4 分布式服务器插件

**位置：** `/VCPDistributedServer/Plugin/`

每个插件包含 `plugin.js`（主实现）和 `manifest.json`（元数据），启动时自动发现，AI 可通过工具系统调用。

### 6.5 正则规则（每 Agent 独立）

通过设置 → Agent → 正则规则配置。支持上下文范围（发送前应用）和前端范围（显示时应用）。

### 6.6 Agent 配置

每个 Agent 的 `config.json` 支持：名称、模型、系统提示、温度、最大令牌、上下文长度、头像、正则规则、提示模式、音乐控制、专注锁设置等。

### 6.7 群聊模式扩展

继承 `/Groupmodules/modes/baseChatMode.js` 基类，实现 `selectNextSpeaker()` 和 `generateResponse()` 方法即可添加新的群聊模式。

### 6.8 全局设置

编辑 `settings.json` 或使用 UI：
```json
{
  "vcpServerUrl": "http://localhost:6005/v1/chat/completions",
  "vcpLogUrl": "ws://localhost:6005",
  "vcpApiKey": "your-api-key",
  "enableVcpToolInjection": true,
  "theme": "dark",
  "language": "zh-CN"
}
```

---

## 附录：数据存储结构

```
AppData/
├── Agents/{agentId}/config.json          # Agent 元数据、提示、设置
├── AgentGroups/{groupId}/config.json     # 群组设置、成员、提示
├── UserData/
│   ├── {agentId}/topics/{topicId}/
│   │   ├── history.json                  # 聊天消息
│   │   └── metadata.json                 # 话题时间戳等
│   ├── attachments/{id}.png              # 附件文件
│   └── user_avatar.png                   # 用户头像
├── Notemodules/                          # 用户笔记树
├── settings.json                         # 全局应用设置
├── songlist.json                         # 音乐播放列表
├── MusicCoverCache/                      # 封面缓存
├── ResampleCache/                        # 重采样音频缓存
└── canvas/                               # 画布文档
```

## 附录：消息格式

```json
{
  "role": "user|assistant|system",
  "content": "文本内容或对象数组",
  "timestamp": 1704067200000,
  "id": "msg_uuid",
  "agentId": "agent_id",
  "avatar": "base64_or_path",
  "metadata": {
    "tool_calls": [{}],
    "fileAPI": [{}],
    "thought_chain": "..."
  }
}
```

---

*Document generated: 2026-03-31*
*文档生成日期：2026-03-31*
