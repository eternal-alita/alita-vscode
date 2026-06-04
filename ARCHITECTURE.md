# Alita 架构说明

## 概述

Alita 是一个实现 `LanguageModelChatProvider` API 的 VS Code 扩展，作为 VS Code 原生聊天/代理界面与外部 OpenAI 兼容 API 网关之间的**薄代理层**。

核心设计原则：**无自定义 UI**。Alita 直接接入 VS Code 内置的聊天、代理和工具体验，用户通过他们已经熟悉的同一界面交互。

## 组件架构

```
┌──────────────────────────────────────────────────────────────┐
│                     VS Code 宿主                              │
│  ┌─────────────────────┐  ┌──────────────────────────────┐   │
│  │    聊天 / 代理界面    │  │  LanguageModelChatProvider    │   │
│  │  （VS Code 内置）     │◄─┤         API                  │   │
│  └─────────────────────┘  └──────────┬───────────────────┘   │
│                                      │                       │
│  ┌───────────────────────────────────▼────────────────────┐  │
│  │                    Alita 扩展                           │  │
│  │                                                         │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │              extension.ts（入口）                  │    │  │
│  │  │  - 注册模型提供者                                 │    │  │
│  │  │  - 注册工作区工具                                 │    │  │
│  │  └──────────────────┬──────────────────────────────┘    │  │
│  │                     │                                    │  │
│  │  ┌──────────────────▼──────────────────────────────┐    │  │
│  │  │              provider.ts（聊天提供者）              │    │  │
│  │  │  - 构建消息（含系统提示）                          │    │  │
│  │  │  - 路由到对话/代理模式                            │    │  │
│  │  │  - 转换 VS Code ↔ Gateway 消息格式               │    │  │
│  │  │  - 将工具调用结果回传给 VS Code                   │    │  │
│  │  │  - 从配置 / 环境变量读取后端模型名                 │    │  │
│  │  └──────────────────┬──────────────────────────────┘    │  │
│  │                     │                                    │  │
│  │  ┌──────────────────▼──────────────────────────────┐    │  │
│  │  │              gateway.ts（HTTP 客户端）             │    │  │
│  │  │  - OpenAI 兼容的 /v1/chat/completions             │    │  │
│  │  │  - 流式（SSE）和非流式两种模式                    │    │  │
│  │  │  - 可配置的 URL + API Key                        │    │  │
│  │  │  - AbortController 取消支持                       │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  │                                                         │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │              tools.ts（工作区工具）                │    │  │
│  │  │  - alita_readFiles：读取文件内容                   │    │  │
│  │  │  - alita_editFile：SEARCH/REPLACE 编辑            │    │  │
│  │  │  - alita_terminal：执行 Shell 命令                │    │  │
│  │  │  - alita_searchFiles：按内容或文件名搜索          │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                             │ HTTP
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     后端网关（第三方）                             │
│                                                                  │
│  给定系统提示词 + 对话历史 + 工具定义，后端决定如何处理——          │
│  生成文本、调用工具、或两者同时进行。Alita 将后端的响应            │
│  （文本 + 工具调用）转发回 VS Code 呈现给用户。                   │
│                                                                  │
│  例如：Hermes Gateway 在 LLM 之上提供身份注入、记忆检索和         │
│  工具编排等能力。                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 数据流

### 代理模式（带工具）

```
用户输入请求
    │
    ▼
VS Code 聊天视图
    │
    ▼
AlitaChatProvider.provideLanguageModelChatResponse()
    │
    ├─ _buildMessages()  → 前置系统提示词
    │
    ├─ _buildTools()     → 将 VS Code 工具定义转为 OpenAI 格式
    │
    ├─ GatewayClient.chatNonStreaming()  → POST /v1/chat/completions
    │      │
    │      ▼ HTTP
    │   后端决策：生成文本、工具调用、或两者
    │      │
    │      ▼
    │   GatewayClient 返回 { content, tool_calls }
    │
    ├─ 将文本内容报告给 progress（如有）
    │
    └─ 将工具调用报告给 progress（如有）
           │
           ▼
       VS Code 执行工具，将结果以 tool 角色的消息回传
           │
           ▼
       （下一轮继续循环）
```

### 对话模式（无工具，流式）

```
用户输入请求
    │
    ▼
AlitaChatProvider.provideLanguageModelChatResponse()
    │
    ├─ _buildMessages()
    │
    └─ GatewayClient.chatStream()  → POST /v1/chat/completions (stream: true)
           │
           ▼ SSE 流
       每收到一个 chunk：progress.report(new LanguageModelTextPart(chunk))
```

## 消息格式转换

Alita 在 VS Code 消息格式和 OpenAI 兼容格式之间做转换：

| VS Code 角色 | Gateway 角色 | 说明 |
|-------------|-------------|------|
| 用户文本 | `user` | 文本部分拼接 |
| 用户工具结果 | `tool` | 附带 `tool_call_id` |
| 助手文本 + 工具调用 | `assistant` | 可选附带 `tool_calls` |

消息数组始终以 `system` 角色的消息开头，包含系统提示词。

## 配置说明

Alita 通过 VS Code 配置系统对外暴露三项设置（`alita.*`）：

| 配置项 | 类型 | 默认值 | 读取优先级 |
|--------|------|--------|-----------|
| `alita.gatewayUrl` | string | `http://localhost:8642` | VS Code 设置 → `ALITA_GATEWAY_URL` → 默认值 |
| `alita.apiKey` | string | `""` | VS Code 设置 → `ALITA_API_KEY` → `""` |
| `alita.model` | string | `gpt-4o` | VS Code 设置 → `ALITA_MODEL` → 默认值 |

### 解析位置

- **`alita.gatewayUrl`** —— 在 `GatewayClient._getGatewayUrl()` 中解析，用于拼接 API 端点 `/v1/chat/completions`
- **`alita.apiKey`** —— 在 `GatewayClient._getApiKey()` 中解析，写入 HTTP 请求头的 `Authorization: Bearer` 字段
- **`alita.model`** —— 在 `AlitaChatProvider._getBackendModel()` 中解析，作为请求体的 `model` 字段发送给后端

### 配置优先级

所有三项配置都遵循相同的优先级：**VS Code 设置 > 环境变量 > 硬编码默认值**。

环境变量在以下场景特别有用：
- 团队共享工作区时通过 `.env` 或 launch.json 注入
- CI/CD 环境中无需人工配置
- 安全敏感场景：避免将 API Key 和模型名写在 VS Code 设置中

## 工具定义

工具通过 `vscode.lm.registerTool()` 注册到 VS Code，并通过 `vscode.lm.selectChatModels()` 在构建 Agent 时被包含。Provider 将它们封装为 OpenAI 兼容的 `tools` 数组格式发送给后端。后端需要正确处理 `tool_choice` 参数（`auto` 或 `required`）。

## 扩展指南

### 添加新工具

1. 在 `tools.ts` 中注册（参照现有 `registerTool()` 模式）
2. 在 `package.json` → `contributes.languageModelTools` 中添加贡献声明
3. 可选：更新 `provider.ts` 中的系统提示词，描述新工具的用途

### 更换后端协议

修改 `gateway.ts` 即可——扩展的其他部分只依赖于 `GatewayClient` 接口的契约。
