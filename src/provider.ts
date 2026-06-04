import * as vscode from 'vscode';
import { GatewayClient, GatewayMessage, GatewayTool, GatewayToolCall } from './gateway';

const ALITA_SYSTEM_PROMPT = `You are Alita, a capable AI coding agent integrated into VS Code.

Core behaviors:
- You have access to workspace tools: read files, edit files, run terminal commands, search files
- Use the most appropriate tool for each task — prefer file search over reading files blindly
- Always verify your work after making changes — check syntax, test the output
- When writing code, consider edge cases and error handling
- Communicate clearly and concisely in the user's language

You interact with the editor through the VS Code Language Model API:
- alita_readFiles — read file contents
- alita_editFile — edit files using SEARCH/REPLACE
- alita_terminal — run shell commands
- alita_searchFiles — search files by content or name`;

const ALITA_MODEL_INFO: vscode.LanguageModelChatInformation = {
  id: 'alita',
  name: 'Alita',
  family: 'deepseek-v4-flash',
  version: '0.1.0',
  maxInputTokens: 128000,
  maxOutputTokens: 8192,
  capabilities: {
    toolCalling: 32,
  },
};

export class AlitaChatProvider implements vscode.LanguageModelChatProvider<vscode.LanguageModelChatInformation> {
  private _gateway = new GatewayClient();

  onDidChangeLanguageModelChatInformation?: vscode.Event<void>;

  provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.LanguageModelChatInformation[]> {
    return [ALITA_MODEL_INFO];
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const gatewayMessages = this._buildMessages(messages);
    const hasTools = options.tools && options.tools.length > 0;

    if (hasTools) {
      await this._handleToolCalling(model, gatewayMessages, options, progress, token);
    } else {
      await this._handleStreaming(model, gatewayMessages, progress, token);
    }
  }

  /**
   * Agent mode: non-streaming with tool definitions, handles tool calls.
   */
  private async _handleToolCalling(
    model: vscode.LanguageModelChatInformation,
    messages: GatewayMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const tools = this._buildTools(options.tools!);
    const toolChoice = options.toolMode === vscode.LanguageModelChatToolMode.Required
      ? 'required' as const
      : 'auto' as const;

    const response = await this._gateway.chatNonStreaming({
      model: model.id,
      messages,
      stream: false,
      max_tokens: 8192,
      temperature: 0.7,
      tools,
      tool_choice: toolChoice,
    }, token);

    if (token.isCancellationRequested) return;

    // Report text content (if any)
    if (response.content) {
      progress.report(new vscode.LanguageModelTextPart(response.content));
    }

    // Report tool calls (if any)
    for (const tc of response.tool_calls) {
      progress.report(new vscode.LanguageModelToolCallPart(
        tc.id,
        tc.function.name,
        JSON.parse(tc.function.arguments)
      ));
    }
  }

  /**
   * Ask mode: streaming text response, no tool definitions.
   */
  private async _handleStreaming(
    model: vscode.LanguageModelChatInformation,
    messages: GatewayMessage[],
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const stream = this._gateway.chatStream({
      model: model.id,
      messages,
      stream: true,
      max_tokens: 8192,
      temperature: 0.7,
    }, token);

    try {
      for await (const chunk of stream) {
        if (token.isCancellationRequested) break;
        progress.report(new vscode.LanguageModelTextPart(chunk));
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      throw err;
    }
  }

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') {
      return Promise.resolve(Math.ceil(text.length / 4));
    }
    const content = text.content.map(c => String(c)).join('\n');
    return Promise.resolve(Math.ceil(content.length / 4));
  }

  private _buildTools(tools: readonly vscode.LanguageModelChatTool[]): GatewayTool[] {
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as object ?? { type: 'object', properties: {} },
      },
    }));
  }

  private _buildMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
  ): GatewayMessage[] {
    const result: GatewayMessage[] = [
      { role: 'system', content: ALITA_SYSTEM_PROMPT },
    ];

    for (const msg of messages) {
      if (msg.role === vscode.LanguageModelChatMessageRole.User) {
        this._collectUserMessageParts(msg, result);
      } else {
        this._collectAssistantMessageParts(msg, result);
      }
    }

    return result;
  }

  private _collectUserMessageParts(
    msg: vscode.LanguageModelChatRequestMessage,
    result: GatewayMessage[]
  ): void {
    let textParts: string[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        // Flush accumulated text first
        if (textParts.length > 0) {
          result.push({ role: 'user', content: textParts.join('\n') });
          textParts = [];
        }
        // Tool result: use OpenAI tool role
        result.push({
          role: 'tool',
          tool_call_id: part.callId,
          content: part.content.map(c => String(c)).join('\n'),
        });
      }
    }

    if (textParts.length > 0) {
      result.push({ role: 'user', content: textParts.join('\n') });
    }
  }

  private _collectAssistantMessageParts(
    msg: vscode.LanguageModelChatRequestMessage,
    result: GatewayMessage[]
  ): void {
    let textParts: string[] = [];
    const toolCalls: GatewayToolCall[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        // Assistant requested tool calls
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input),
          },
        });
      }
    }

    const entry: GatewayMessage = {
      role: 'assistant',
      content: textParts.join('\n'),
    };
    if (toolCalls.length > 0) {
      entry.tool_calls = toolCalls;
    }
    result.push(entry);
  }
}
