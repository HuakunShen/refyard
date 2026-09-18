/**
 * The extension: one repository (the folder VS Code has open), one service, one panel.
 *
 * The host owns the CLI process and every token; the webview only draws. A read is a
 * postMessage naming a kind, and the answer carries the service's own DTO — validated by
 * the shared contract client on this side, so the webview can trust the shapes it gets.
 */
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  startMachineService,
  stopService,
  ServiceError,
  type RunningService,
} from "./supervisor.js";
import type {
  BridgeAnswer,
  BridgeRequest,
  WorkbenchAnswer,
} from "./protocol.js";

const HOST_ROOT = dirname(fileURLToPath(import.meta.url));

class Workbench {
  private panel: vscode.WebviewPanel | null = null;
  private service: RunningService | null = null;
  private repositoryId = "";

  constructor(private readonly statusItem: vscode.StatusBarItem) {}

  readonly open = (): void => {
    void this.openPanel().catch((error: unknown) => {
      this.statusItem.text = "$(git-branch) Refyard";
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
    });
  };

  readonly refresh = (): void => {
    this.panel?.webview.postMessage({ kind: "refresh" });
  };

  readonly shutdown = (): void => {
    if (this.service !== null) {
      stopService(this.service);
    }
    this.panel?.dispose();
    this.panel = null;
    this.statusItem.text = "$(git-branch) Refyard";
  };

  readonly dispose = (): void => {
    if (this.service !== null) {
      stopService(this.service);
    }
  };

  private async openPanel(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      void vscode.window.showErrorMessage(
        "Refyard: open a folder that is a Git repository first.",
      );
      return;
    }
    if (this.panel !== null) {
      this.panel.reveal();
      return;
    }

    this.statusItem.text = "$(sync~spin) Refyard";
    this.service = await this.ensureService(folder.uri.fsPath);
    const listing = await this.service.client.repositories();
    const record = listing.repositories[0];
    if (record === undefined) {
      throw new ServiceError(
        "the refyard service listed no repositories; open a Git repository folder.",
      );
    }
    this.repositoryId = record.repositoryId;

    const panel = vscode.window.createWebviewPanel(
      "refyard.workbench",
      `Refyard — ${record.displayName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(join(HOST_ROOT, "webview"))],
      },
    );
    this.panel = panel;
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage((request: BridgeRequest) => {
      void this.answer(request);
    });
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = null;
      }
      this.statusItem.text = "$(git-branch) Refyard";
    });
  }

  private async ensureService(repositoryPath: string): Promise<RunningService> {
    const configuration = vscode.workspace.getConfiguration("refyard");
    const cliPath =
      (configuration.get<string>("cliPath") ?? "refyard-native").trim() ||
      "refyard-native";
    const stateDir = await mkdtemp(join(tmpdir(), "refyard-vscode-"));
    return startMachineService({
      cliPath,
      repositoryPath,
      stateDir,
      environment: { ...process.env, TMPDIR: tmpdir() },
    });
  }

  private async answer(request: BridgeRequest): Promise<void> {
    try {
      const answer: BridgeAnswer = {
        id: request.id,
        ok: true,
        answer: await this.read(request),
      };
      await this.panel?.webview.postMessage(answer);
    } catch (error) {
      const problem = {
        code: error instanceof ServiceError ? "ServiceError" : "InternalError",
        message: error instanceof Error ? error.message : String(error),
      };
      const answer: BridgeAnswer = { id: request.id, ok: false, problem };
      await this.panel?.webview.postMessage(answer);
    }
  }

  private async read(request: BridgeRequest): Promise<WorkbenchAnswer> {
    if (this.service === null) {
      throw new ServiceError("the refyard service is not running");
    }
    const client = this.service.client;
    const repositoryId = this.repositoryId;
    switch (request.payload.kind) {
      case "status":
        return {
          kind: "status",
          snapshot: await client.status({ repositoryId }),
        };
      case "history":
        return {
          kind: "history",
          page: await client.history({
            repositoryId,
            ...(request.payload.cursor === null
              ? {}
              : { cursor: request.payload.cursor }),
          }),
        };
      case "diff":
        return {
          kind: "diff",
          diff: await client.diff({
            repositoryId,
            kind: request.payload.diffKind,
            ...(request.payload.pathId === undefined
              ? {}
              : { pathId: request.payload.pathId }),
            ...(request.payload.oid === undefined
              ? {}
              : { oid: request.payload.oid }),
          }),
        };
    }
  }

  private html(webview: vscode.Webview): string {
    const script = webview
      .asWebviewUri(vscode.Uri.file(join(HOST_ROOT, "webview", "workbench.js")))
      .toString();
    // Inlined rather than a second resource: one file, and the CSP stays at default-src 'none'.
    const css = readFileSync(
      join(HOST_ROOT, "webview", "refyard-vscode.css"),
      "utf8",
    );
    const nonce = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0"),
    ).join("");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};" />
  <style>${css}</style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );
  statusItem.command = "refyard.openWorkbench";
  statusItem.text = "$(git-branch) Refyard";
  statusItem.tooltip = "Open the Refyard workbench";
  statusItem.show();

  const workbench = new Workbench(statusItem);
  context.subscriptions.push(
    statusItem,
    { dispose: () => workbench.dispose() },
    vscode.commands.registerCommand("refyard.openWorkbench", workbench.open),
    vscode.commands.registerCommand("refyard.refresh", workbench.refresh),
    vscode.commands.registerCommand("refyard.shutdown", workbench.shutdown),
  );
}

export function deactivate(): void {}
