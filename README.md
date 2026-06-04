# Alita — VS Code Native AI Coding Agent

**Alita** is a VS Code extension that brings a full-featured AI coding agent directly into your editor, powered by any OpenAI-compatible API gateway (such as [Hermes Gateway](https://hermes-agent.nousresearch.com)).

Built on VS Code's [Language Model API](https://code.visualstudio.com/api/extension-guides/language-model) (available since VS Code 1.99), Alita provides both **chat** and **agent** modes with native workspace tool integration — no custom UI, no side panels, just pure editor-native AI interaction.

## Features

- **Agent Mode** — Alita can read files, edit code, run terminal commands, and search your workspace, all through native VS Code Chat UX
- **Ask Mode** — Streaming chat responses from your backend model, integrated into VS Code's Chat view
- **Tool Orchestration** — Agent mode sends tool definitions to the backend; the backend decides when and how to call them
- **Zero Custom UI** — No webviews, no custom sidebars — everything runs through VS Code's built-in Chat and Agent experiences
- **Configurable Backend** — Works with any OpenAI-compatible API endpoint (Hermes Gateway, llama.cpp, vLLM, etc.)

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    VS Code Editor                    │
│  ┌──────────────────────────────────────────────┐   │
│  │              Chat / Agent View               │   │
│  └──────────────┬───────────────────────────────┘   │
│                 │ VS Code Language Model API         │
│  ┌──────────────▼───────────────────────────────┐   │
│  │           Alita Extension (this)              │   │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────┐  │   │
│  │  │ Provider  │  │ Gateway  │  │ Tools (4)  │  │   │
│  │  │ (Chat)    │  │ Client   │  │ Read/Edit/ │  │   │
│  │  │           │  │ (HTTP)   │  │ Term/Search│  │   │
│  │  └──────────┘  └────┬─────┘  └────────────┘  │   │
│  └─────────────────────┼────────────────────────┘   │
└────────────────────────┼────────────────────────────┘
                         │ HTTP (OpenAI-compatible)
┌────────────────────────▼───────────────────────────┐
│           Backend Gateway (Hermes / any)             │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐   │
│  │ Identity │ │ Memory   │ │ LLM Inference      │   │
│  │ Injection│ │ Retrieval│ │ (tool calling etc.)│   │
│  └──────────┘ └──────────┘ └────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

For a detailed architecture breakdown, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quick Start

### Prerequisites

- **VS Code** 1.99 or later
- A running **OpenAI-compatible API gateway** (see Backend Setup below)
- **Node.js 22+** and **npm** (if building from source)

### Installation

1. Download the latest `.vsix` from [Releases](https://github.com/eternal-alita/alita-vscode/releases)
2. In VS Code, press `Cmd+Shift+P` → `Extensions: Install from VSIX...` → select the file
3. **Reload Window** — `Cmd+Shift+P` → `Developer: Reload Window`

Or build from source:

```bash
git clone https://github.com/eternal-alita/alita-vscode.git
cd alita-vscode
npm install
npm run compile
npx vsce package
# Install the generated .vsix as above
```

### Configuration

Alita needs to connect to an API gateway. Configure via VS Code settings (`Cmd+,` → search "alita"):

| Setting | Default | Description |
|---------|---------|-------------|
| `alita.gatewayUrl` | `http://localhost:8642` | Your gateway's OpenAI-compatible endpoint |
| `alita.apiKey` | `""` | API key (leave empty if not required) |

Can also be set via environment variables: `ALITA_GATEWAY_URL` and `ALITA_API_KEY`.

### Usage

1. Open VS Code Chat: `Cmd+Shift+I`
2. Select **Alita** as the chat model from the dropdown
3. Choose **Ask** mode for chat, or **Agent** mode for tool access
4. Start typing your requests

**Ask mode** — streaming text responses from your backend, no tool access.

**Agent mode** — Alita can use these tools:

| Tool | Description |
|------|-------------|
| `alita_readFiles` | Read one or more workspace files |
| `alita_editFile` | Edit files using SEARCH/REPLACE blocks |
| `alita_terminal` | Execute shell commands |
| `alita_searchFiles` | Search file contents or find files by name |

### Backend Setup

Alita requires a running OpenAI-compatible API gateway. Recommended options:

- **[Hermes Gateway](https://hermes-agent.nousresearch.com)** — Full-featured agent framework with identity injection, memory retrieval, and tool orchestration
- **llama.cpp** — Lightweight local inference server
- **vLLM** — Production-grade inference serving
- **Any OpenAI-compatible proxy** — works with any endpoint serving the `/v1/chat/completions` API

## Project Structure

```
alita-vscode/
├── src/
│   ├── extension.ts      # VS Code extension entry point
│   ├── gateway.ts        # HTTP client for the backend API
│   ├── provider.ts       # VS Code LanguageModelChatProvider implementation
│   └── tools.ts          # Tool registrations (read, edit, terminal, search)
├── icon-dark.svg         # Dark theme icon
├── icon-light.svg        # Light theme icon
├── package.json          # Extension manifest & configuration
├── tsconfig.json         # TypeScript configuration
└── .vscodeignore         # Build exclusions
```

## Development

```bash
npm install
npm run compile     # TypeScript → JavaScript
npm run watch       # Watch mode for iterative development
npm run package     # Build .vsix for distribution
```

## Security

- **API keys are never hardcoded** — configure via VS Code settings or environment variables
- **No telemetry** — Alita does not collect usage data
- **No external network calls** — all traffic goes to your configured gateway URL
- **Works fully offline** — if your gateway runs locally

## License

MIT License — see [LICENSE](./LICENSE).

---

Built with vscode-language-model-api. Not affiliated with VS Code or Microsoft.
