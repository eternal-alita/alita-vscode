# Alita — VS Code 原生 AI 编码助手

**Alita** 是一款 VS Code 扩展，通过任何兼容 OpenAI API 的后端网关（如 [Hermes Gateway](https://hermes-agent.nousresearch.com)）提供完整的 AI 编码助手能力。

基于 VS Code 的 [Language Model API](https://code.visualstudio.com/api/extension-guides/language-model)（自 VS Code 1.99 起可用），Alita 同时提供**对话**和**代理**两种模式，原生集成工作区工具——无需自定义 UI、无需侧面板，纯粹的编辑器原生 AI 交互体验。

## 功能特性

- **代理模式** — Alita 可以读取文件、编辑代码、执行终端命令、搜索工作区文件，全部通过 VS Code 原生聊天界面完成
- **对话模式** — 流式对话响应，集成在 VS Code 聊天视图中
- **工具编排** — 代理模式下将工具定义发送给后端，由后端决定何时调用、如何调用
- **零自定义 UI** — 无 Webview、无自定义侧边栏，全部基于 VS Code 内置的聊天和代理体验
- **可配置后端** — 兼容任何 OpenAI 接口的端点（Hermes Gateway、llama.cpp、vLLM 等）

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                    VS Code 编辑器                     │
│  ┌──────────────────────────────────────────────┐   │
│  │             聊天 / 代理视图                    │   │
│  └──────────────┬───────────────────────────────┘   │
│                 │ VS Code Language Model API         │
│  ┌──────────────▼───────────────────────────────┐   │
│  │           Alita 扩展（本插件）                  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────┐  │   │
│  │  │ Provider  │  │ Gateway  │  │ 工具(4个)  │  │   │
│  │  │ (聊天)    │  │ 客户端   │  │ 读/编辑/   │  │   │
│  │  │           │  │ (HTTP)   │  │ 终端/搜索  │  │   │
│  │  └──────────┘  └────┬─────┘  └────────────┘  │   │
│  └─────────────────────┼────────────────────────┘   │
└────────────────────────┼────────────────────────────┘
                         │ HTTP（OpenAI 兼容）
┌────────────────────────▼───────────────────────────┐
│           后端网关（Hermes / 任意）                   │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐   │
│  │ 身份注入  │ │ 记忆检索  │ │ LLM 推理          │   │
│  │          │ │          │ │（工具调用等）        │   │
│  └──────────┘ └──────────┘ └────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

详细架构说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 快速开始

### 前置依赖

- **VS Code** 1.99 或更高版本
- 一个正在运行的 **OpenAI 兼容 API 网关**（见后端设置）
- **Node.js 22+** 和 **npm**（如需从源码构建）

### 安装

1. 从 [Releases](https://github.com/eternal-alita/alita-vscode/releases) 下载最新的 `.vsix`
2. 在 VS Code 中按 `Cmd+Shift+P` → `Extensions: Install from VSIX...` → 选择文件
3. **重载窗口** — `Cmd+Shift+P` → `Developer: Reload Window`

或者从源码构建：

```bash
git clone https://github.com/eternal-alita/alita-vscode.git
cd alita-vscode
npm install
npm run compile
npx vsce package
# 按上述方式安装生成的 .vsix
```

### 配置

Alita 需要连接到 API 网关。通过 VS Code 设置配置（`Cmd+,` → 搜索 "alita"）：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `alita.gatewayUrl` | `http://localhost:8642` | 网关的 OpenAI 兼容端点 |
| `alita.apiKey` | `""` | API 密钥（如无需鉴权可留空） |
| `alita.model` | `gpt-4o` | 发送给后端的模型名称 |

以上配置也可以通过环境变量设置：

| 设置项 | 环境变量 |
|--------|---------|
| `alita.gatewayUrl` | `ALITA_GATEWAY_URL` |
| `alita.apiKey` | `ALITA_API_KEY` |
| `alita.model` | `ALITA_MODEL` |

配置读取优先级：**VS Code 设置 > 环境变量 > 默认值**。

### 使用

1. 打开 VS Code 聊天：`Cmd+Shift+I`
2. 从模型下拉菜单中选择 **Alita**
3. 选择 **对话** 模式（纯聊天）或 **代理** 模式（使用工具）
4. 输入你的需求

**对话模式** — 流式文本响应，无工具访问权限。

**代理模式** — Alita 可使用以下工具：

| 工具 | 说明 |
|------|------|
| `alita_readFiles` | 读取一个或多个工作区文件 |
| `alita_editFile` | 使用 SEARCH/REPLACE 编辑文件 |
| `alita_terminal` | 执行 Shell 命令 |
| `alita_searchFiles` | 搜索文件内容或按文件名查找 |

### 后端设置

Alita 需要一个正在运行的 OpenAI 兼容 API 网关。推荐选项：

- **[Hermes Gateway](https://hermes-agent.nousresearch.com)** — 功能完善的 Agent 框架，支持身份注入、记忆检索和工具编排
- **llama.cpp** — 轻量级本地推理服务器
- **vLLM** — 生产级推理服务
- **任意 OpenAI 兼容代理** — 只要提供 `/v1/chat/completions` 端点即可

## 项目结构

```
alita-vscode/
├── src/
│   ├── extension.ts      # VS Code 扩展入口
│   ├── gateway.ts        # 后端 API HTTP 客户端
│   ├── provider.ts       # VS Code LanguageModelChatProvider 实现
│   └── tools.ts          # 工具注册（读、编辑、终端、搜索）
├── icon-dark.svg         # 暗色主题图标
├── icon-light.svg        # 亮色主题图标
├── package.json          # 扩展清单与配置声明
├── tsconfig.json         # TypeScript 配置
└── .vscodeignore         # 构建排除规则
```

## 开发

```bash
npm install
npm run compile     # TypeScript → JavaScript
npm run watch       # 监听模式，迭代开发
npm run package     # 构建 .vsix 用于分发
```

## 安全

- **API 密钥不硬编码** — 通过 VS Code 设置或环境变量配置
- **无遥测** — Alita 不收集任何使用数据
- **无外部网络** — 所有流量发往你配置的网关地址
- **完全离线** — 如果你的网关运行在本地

## 许可证

MIT 许可证 — 见 [LICENSE](./LICENSE)。

---

基于 vscode-language-model-api 构建。与 VS Code 或 Microsoft 无关。
