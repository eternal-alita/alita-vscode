# Alita Architecture

## Overview

Alita is a VS Code extension that implements the `LanguageModelChatProvider` API to provide an AI coding agent. It acts as a **thin proxy layer** between VS Code's native Chat/Agent UI and an external OpenAI-compatible API gateway.

The key design principle: **no custom UI**. Alita plugs directly into VS Code's built-in Chat, Agent, and tool experiences, so users interact with it through the same interface they already know.

## Component Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     VS Code Host                              │
│  ┌─────────────────────┐  ┌──────────────────────────────┐   │
│  │    Chat / Agent UI   │  │  LanguageModelChatProvider    │   │
│  │  (built-in vs code)  │◄─┤         API                  │   │
│  └─────────────────────┘  └──────────┬───────────────────┘   │
│                                      │                       │
│  ┌───────────────────────────────────▼────────────────────┐  │
│  │                    Alita Extension                      │  │
│  │                                                         │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │              extension.ts (entry)                │    │  │
│  │  │  - Registers model provider                      │    │  │
│  │  │  - Registers workspace tools                     │    │  │
│  │  └──────────────────┬──────────────────────────────┘    │  │
│  │                     │                                    │  │
│  │  ┌──────────────────▼──────────────────────────────┐    │  │
│  │  │              provider.ts (chat provider)          │    │  │
│  │  │  - Builds messages (including system prompt)     │    │  │
│  │  │  - Routes to ask/agent mode                      │    │  │
│  │  │  - Translates VS Code ↔ Gateway message formats  │    │  │
│  │  │  - Reports tool calls back to VS Code             │    │  │
│  │  └──────────────────┬──────────────────────────────┘    │  │
│  │                     │                                    │  │
│  │  ┌──────────────────▼──────────────────────────────┐    │  │
│  │  │              gateway.ts (HTTP client)             │    │  │
│  │  │  - OpenAI-compatible /v1/chat/completions         │    │  │
│  │  │  - Streaming (SSE) and non-streaming modes        │    │  │
│  │  │  - Configurable URL + API key                    │    │  │
│  │  │  - AbortController for cancellation               │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  │                                                         │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │              tools.ts (workspace tools)            │    │  │
│  │  │  - alita_readFiles: read file contents            │    │  │
│  │  │  - alita_editFile: SEARCH/REPLACE editing          │    │  │
│  │  │  - alita_terminal: shell command execution        │    │  │
│  │  │  - alita_searchFiles: content/filename search     │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │ HTTP
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Gateway Backend (3rd-party)                    │
│                                                                  │
│  Given a system prompt + conversation history + tool definitions,│
│  the backend decides what to do — generate text, call tools, or  │
│  both.  Alita forwards the backend's responses (text + tool      │
│  calls) back to VS Code for the user to see.                     │
│                                                                  │
│  Example: Hermes Gateway provides identity injection, memory     │
│  retrieval, and tool orchestration on top of the LLM.            │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Agent Mode (with tools)

```
User types request
    │
    ▼
VS Code Chat View
    │
    ▼
AlitaChatProvider.provideLanguageModelChatResponse()
    │
    ├─ _buildMessages()  →  prepend system prompt
    │
    ├─ _buildTools()     →  convert VS Code tool definitions to OpenAI format
    │
    ├─ GatewayClient.chatNonStreaming()  →  POST /v1/chat/completions
    │      │
    │      ▼ HTTP
    │   Backend decides: generates text, tool calls, or both
    │      │
    │      ▼
    │   GatewayClient returns { content, tool_calls }
    │
    ├─ Report text content to progress (if any)
    │
    └─ Report tool calls to progress (if any)
           │
           ▼
       VS Code executes tools, feeds results back as tool-role messages
           │
           ▼
       (next turn continues the cycle)
```

### Ask Mode (no tools, streaming)

```
User types request
    │
    ▼
AlitaChatProvider.provideLanguageModelChatResponse()
    │
    ├─ _buildMessages()
    │
    └─ GatewayClient.chatStream()  →  POST /v1/chat/completions (stream: true)
           │
           ▼ SSE stream
       For each chunk: progress.report(new LanguageModelTextPart(chunk))
```

## Message Translation

Alita translates between VS Code's message format and the OpenAI-compatible format:

| VS Code Role | Gateway Role | Notes |
|-------------|--------------|-------|
| User text | `user` | Text parts concatenated |
| User tool results | `tool` | With `tool_call_id` |
| Assistant text + tool calls | `assistant` | With optional `tool_calls` |

The message array is always prefixed with a `system`-role message containing the system prompt.

## Configuration

Two settings are exposed via VS Code's configuration system (`alita.*`):

| Key | Type | Default | Source Priority |
|-----|------|---------|-----------------|
| `alita.gatewayUrl` | string | `http://localhost:8642` | VS Code setting → env `ALITA_GATEWAY_URL` → default |
| `alita.apiKey` | string | `""` | VS Code setting → env `ALITA_API_KEY` → `""` |

The resolution happens at runtime in `GatewayClient._getGatewayUrl()` and `GatewayClient._getApiKey()`.

## Tool Definitions

Tools are registered with VS Code via `vscode.lm.registerTool()` and included when the Agent is built via `vscode.lm.selectChatModels()`. The provider wraps them in OpenAI-compatible `tools` array format for the backend. The backend must respect the `tool_choice` parameter (`auto` or `required`).

## Extending

To add a new tool:

1. Register it in `tools.ts` (follow the existing `registerTool()` pattern)
2. Add the contribution to `package.json` → `contributes.languageModelTools`
3. The system prompt in `provider.ts` can be updated to describe the new tool

To support a different backend protocol, modify `gateway.ts` — the rest of the extension depends only on the `GatewayClient` interface.
