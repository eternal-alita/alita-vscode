import * as vscode from 'vscode';
import { AlitaChatProvider } from './provider';
import { registerAlitaTools } from './tools';

export function activate(context: vscode.ExtensionContext) {
  const provider = new AlitaChatProvider();

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('alita', provider)
  );

  registerAlitaTools(context);

  console.log('[alita] Alita ready');
}

export function deactivate() {
  console.log('[alita] Alita offline');
}
