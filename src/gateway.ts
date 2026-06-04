import * as vscode from 'vscode';

/**
 * Default Gateway URL.
 * Override via VS Code setting `alita.gatewayUrl` or env variable `ALITA_GATEWAY_URL`.
 */
const DEFAULT_GATEWAY_URL = 'http://localhost:8642';

export interface GatewayMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: GatewayToolCall[];
  name?: string;
}

export interface GatewayTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export interface GatewayToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface GatewayRequest {
  model: string;
  messages: GatewayMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
  tools?: GatewayTool[];
  tool_choice?: 'auto' | 'required' | 'none';
}

export interface GatewayFullResponse {
  content: string;
  tool_calls: GatewayToolCall[];
  finish_reason: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class GatewayClient {
  private _abortController: AbortController | null = null;

  private _getGatewayUrl(): string {
    return vscode.workspace.getConfiguration('alita').get<string>('gatewayUrl')
      ?? process.env.ALITA_GATEWAY_URL
      ?? DEFAULT_GATEWAY_URL;
  }

  private _getApiKey(): string {
    return vscode.workspace.getConfiguration('alita').get<string>('apiKey')
      ?? process.env.ALITA_API_KEY
      ?? '';
  }

  /**
   * Non-streaming chat request — returns full response including tool_calls.
   * Used when tools are available (Agent mode).
   */
  async chatNonStreaming(
    request: GatewayRequest,
    token: vscode.CancellationToken
  ): Promise<GatewayFullResponse> {
    this._abortController = new AbortController();

    token.onCancellationRequested(() => {
      this._abortController?.abort();
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = this._getApiKey();
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${this._getGatewayUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
      signal: this._abortController.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      throw new Error(`Gateway API error ${response.status}: ${text}`);
    }

    const json: any = await response.json();
    const choice = json.choices?.[0];

    return {
      content: choice?.message?.content ?? '',
      tool_calls: choice?.message?.tool_calls ?? [],
      finish_reason: choice?.finish_reason ?? 'stop',
      usage: json.usage,
    };
  }

  /**
   * Streaming chat request — yields text chunks as they arrive.
   * Used when no tools are provided (Ask mode).
   */
  async *chatStream(
    request: GatewayRequest,
    token: vscode.CancellationToken
  ): AsyncGenerator<string> {
    this._abortController = new AbortController();

    token.onCancellationRequested(() => {
      this._abortController?.abort();
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };
    const apiKey = this._getApiKey();
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${this._getGatewayUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
      signal: this._abortController.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      throw new Error(`Gateway API error ${response.status}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // skip malformed SSE chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
      this._abortController = null;
    }
  }

  abort() {
    this._abortController?.abort();
  }
}
