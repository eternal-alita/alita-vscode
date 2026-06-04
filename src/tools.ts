import * as vscode from 'vscode';

function registerTool<T>(
  context: vscode.ExtensionContext,
  name: string,
  tool: vscode.LanguageModelTool<T>
) {
  context.subscriptions.push(
    vscode.lm.registerTool<T>(name, tool)
  );
}

export function registerAlitaTools(context: vscode.ExtensionContext) {
  registerTool(context, 'alita_readFiles', {
    async invoke(
      options: vscode.LanguageModelToolInvocationOptions<{ paths: string[] }>,
      _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
      const results: string[] = [];
      for (const p of options.input.paths) {
        try {
          const uri = vscode.Uri.file(p);
          const content = (await vscode.workspace.fs.readFile(uri)).toString();
          results.push(`--- ${p} ---\n${content}`);
        } catch (e) {
          results.push(`--- ${p} ---\n[ERROR] ${e}`);
        }
      }
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(results.join('\n\n'))
      ]);
    }
  });

  registerTool(context, 'alita_editFile', {
    async invoke(
      options: vscode.LanguageModelToolInvocationOptions<{ path: string; search: string; replace: string }>,
      _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
      const input = options.input;
      const uri = vscode.Uri.file(input.path);
      const content = (await vscode.workspace.fs.readFile(uri)).toString();
      const idx = content.indexOf(input.search);
      if (idx === -1) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('[ERROR] SEARCH block not found')
        ]);
      }
      const newContent = content.slice(0, idx) + input.replace + content.slice(idx + input.search.length);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, 'utf-8'));
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`[OK] ${input.path} updated`)
      ]);
    }
  });

  registerTool(context, 'alita_terminal', {
    async invoke(
      options: vscode.LanguageModelToolInvocationOptions<{ command: string }>,
      _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
      const terminal = vscode.window.createTerminal('Alita');
      terminal.show(false);
      terminal.sendText(options.input.command);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`[OK] Running: ${options.input.command}`)
      ]);
    }
  });

  registerTool(context, 'alita_searchFiles', {
    async invoke(
      options: vscode.LanguageModelToolInvocationOptions<{ pattern: string; target?: string }>,
      _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
      const input = options.input;
      const files = await vscode.workspace.findFiles(
        input.target === 'files' ? input.pattern : '**/*',
        undefined,
        50
      );
      const results: string[] = [];
      for (const f of files) {
        if (input.target === 'content') {
          const content = (await vscode.workspace.fs.readFile(f)).toString();
          const lines = content.split('\n');
          const matches = lines
            .map((line: string, i: number) => ({ line: i + 1, text: line }))
            .filter(l => l.text.includes(input.pattern));
          if (matches.length > 0) {
            results.push(`--- ${f.fsPath} ---`);
            matches.slice(0, 10).forEach(m =>
              results.push(`  ${m.line}: ${m.text.trim().slice(0, 200)}`)
            );
          }
        } else {
          results.push(f.fsPath);
        }
      }
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          results.length > 0 ? results.slice(0, 100).join('\n') : '[INFO] No matches found'
        )
      ]);
    }
  });
}
