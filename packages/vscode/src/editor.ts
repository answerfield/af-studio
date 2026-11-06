import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import type { Src } from '@answerfield/bundle';
import type { EditReply, FromStudio, ToStudio } from '@answerfield/studio-ui/protocol';
import type { StructureProvider } from './structure.js';
import {
    DESCRIBE_REQUEST, DEV_BUNDLE_REQUEST, EDIT_REQUEST, PALETTE_REQUEST,
    type DescribeResponse, type DevBundleResult, type EditResponse, type PaletteResponse
} from './protocol.js';

/** VS Code language ID of .af files. */
export const LANGUAGE_ID = 'af';
/** View type of the AF custom editor. */
export const EDITOR_VIEW_TYPE = 'af.editor';

/**
 * Preview and visual editor as a custom text editor: one tab per document, undo and save via the text document.
 * Every edit is a text change computed by the language server.
 */
export class AfEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly editors = new Set<AfEditor>();
    private active?: AfEditor;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly client: LanguageClient,
        private readonly structure: StructureProvider
    ) {
        context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
            for (const editor of this.editorsFor(e.textEditor.document.uri)) editor.onTextSelection(e);
        }));
    }

    resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
        const editor = new AfEditor(this.context, this.client, document, panel, this.structure);
        this.editors.add(editor);
        if (panel.active) this.setActive(editor);
        panel.onDidChangeViewState(e => {
            if (e.webviewPanel.active) this.setActive(editor);
            else if (this.active === editor) this.setActive(undefined);
        });
        panel.onDidDispose(() => {
            this.editors.delete(editor);
            if (this.active === editor) this.setActive(undefined);
            editor.dispose();
        });
    }

    /**
     * After a language server validation, refreshes only the editors whose item uses one of the validated documents
     * (directly or via components, libraries, booklets), not every open editor on every keystroke.
     */
    refreshAll(uris?: readonly string[]): void {
        this.editors.forEach(e => { if (e.dependsOn(uris)) e.scheduleRefresh(); });
        this.structure.scheduleRefresh();
    }

    /** Click in the "answerfield-Struktur" view: select the node in the visual editor or preview, else in the text editor. */
    revealNode(uri: vscode.Uri, range: vscode.Range): void {
        const editors = this.editorsFor(uri);
        editors.forEach(e => e.revealFromStructure(range));
        if (editors.length > 0) return;
        const text = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
        if (text) {
            text.selection = new vscode.Selection(range.start, range.start);
            text.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }

    /** Whether an AF editor is currently active. */
    get isActive(): boolean {
        return this.active !== undefined;
    }

    private setActive(editor: AfEditor | undefined): void {
        this.active = editor;
        if (editor) this.structure.setDocument(editor.document.uri);
        this.onDidChangeActive.fire();
    }

    readonly onDidChangeActive = new vscode.EventEmitter<void>();

    private editorsFor(uri: vscode.Uri): AfEditor[] {
        return [...this.editors].filter(e => e.document.uri.toString() === uri.toString());
    }
}

class AfEditor implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private sources: string[] = [];
    /** Documents the preview depends on. */
    private documents: string[] = [];
    private ready = false;
    private refreshTimer?: ReturnType<typeof setTimeout>;
    private request = 0;
    /** Text selection we set ourselves; its echo event is ignored. */
    private ownSelection?: string;
    private disposed = false;
    /** Error message already shown (do not repeat it on every keystroke). */
    private errorShown = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly client: LanguageClient,
        readonly document: vscode.TextDocument,
        private readonly panel: vscode.WebviewPanel,
        private readonly structure: StructureProvider
    ) {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'out', 'studio'),
                vscode.Uri.joinPath(document.uri, '..'),
                ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri)
            ]
        };
        panel.webview.html = this.html();
        this.disposables.push(panel.webview.onDidReceiveMessage((m: FromStudio) => void this.onMessage(m)));
    }

    /** Whether the preview depends on any of these documents; true if none given or before the first bundle. */
    dependsOn(uris: readonly string[] | undefined): boolean {
        if (!uris || this.documents.length === 0) return true;
        const own = this.document.uri.toString();
        return uris.some(u => u === own || this.documents.includes(u));
    }

    scheduleRefresh(): void {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refresh(), 80);
    }

    async refresh(): Promise<void> {
        if (!this.ready || this.disposed) return;
        const request = ++this.request;
        let result: DevBundleResult | null;
        try {
            result = await this.client.sendRequest<DevBundleResult | null>(DEV_BUNDLE_REQUEST, { uri: this.document.uri.toString() });
        } catch (e) {
            // Cancelled, superseded by typing, or server restarting: stay silent; otherwise report once
            if (isCancellation(e) || this.disposed) return;
            this.client.outputChannel.appendLine(`Vorschau konnte nicht aktualisiert werden: ${message(e)}`);
            if (!this.errorShown) {
                this.errorShown = true;
                void vscode.window.showErrorMessage(`answerfield-Editor: ${message(e)}`);
            }
            return;
        }
        this.errorShown = false;
        if (!result || request !== this.request || this.disposed) return;
        this.sources = result.bundle.sources ?? [];
        this.documents = result.documents ?? this.sources;
        this.post({
            kind: 'bundle', bundle: result.bundle, uri: this.document.uri.toString(), version: result.version,
            diagnostics: result.diagnostics,
            baseUrl: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.document.uri, '..')).toString() + '/'
        });
    }

    /** Selection from the "answerfield-Struktur" view: the visual editor or preview follows, and so does a visible text editor. */
    revealFromStructure(range: vscode.Range): void {
        this.post({ kind: 'reveal', offset: this.document.offsetAt(range.start) });
        const visible = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.document.uri.toString());
        if (visible) {
            const selection = new vscode.Selection(range.end, range.start);
            this.ownSelection = `${selection.anchor.line}:${selection.anchor.character}-${selection.active.line}:${selection.active.character}`;
            visible.selection = selection;
            visible.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }

    onTextSelection(e: vscode.TextEditorSelectionChangeEvent): void {
        const selection = e.selections[0];
        const key = `${selection.anchor.line}:${selection.anchor.character}-${selection.active.line}:${selection.active.character}`;
        if (key === this.ownSelection) return;
        this.ownSelection = undefined;
        this.post({ kind: 'reveal', offset: e.textEditor.document.offsetAt(selection.start) });
    }

    private async onMessage(msg: FromStudio): Promise<void> {
        try {
            await this.handle(msg);
        } catch (e) {
            this.client.outputChannel.appendLine(`answerfield-Editor: Nachricht '${msg.kind}' fehlgeschlagen: ${message(e)}`);
        }
    }

    private async handle(message: FromStudio): Promise<void> {
        switch (message.kind) {
            case 'ready':
                this.ready = true;
                await this.refresh();
                break;
            case 'select':
                if (message.src[0] === 0) void this.structure.reveal(this.document.uri, this.document.positionAt(message.src[1]));
                await this.revealSource(message.src, message.focus ?? true);
                break;
            case 'describe': {
                const result = await this.client.sendRequest<DescribeResponse>(DESCRIBE_REQUEST, { uri: this.document.uri.toString(), node: message.node })
                    .catch(() => null);
                this.post({ kind: 'reply', requestId: message.requestId, result });
                break;
            }
            case 'palette': {
                const result = await this.client.sendRequest<PaletteResponse>(PALETTE_REQUEST, { uri: this.document.uri.toString() }).catch(() => []);
                this.post({ kind: 'reply', requestId: message.requestId, result });
                break;
            }
            case 'edit':
                this.post({ kind: 'reply', requestId: message.requestId, result: await this.edit(message.version, message.intent) });
                break;
        }
    }

    private async edit(version: number, intent: unknown): Promise<EditReply> {
        let response: EditResponse;
        try {
            response = await this.client.sendRequest<EditResponse>(EDIT_REQUEST, { uri: this.document.uri.toString(), version, intent });
        } catch (e) {
            return { ok: false, error: message(e) };
        }
        if (!response.ok) return { ok: false, error: response.error };
        // The user kept typing: the ranges no longer match the text, so do not apply
        if (this.document.version !== version) return { ok: false, error: 'Das Dokument hat sich inzwischen geändert – bitte erneut versuchen.' };
        const edit = new vscode.WorkspaceEdit();
        edit.set(this.document.uri, response.edits.map(e => new vscode.TextEdit(
            new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText)));
        const applied = await vscode.workspace.applyEdit(edit);
        return applied ? { ok: true, ...(response.select !== undefined ? { select: response.select } : {}) } : { ok: false, error: 'Änderung wurde nicht übernommen.' };
    }

    /** Shows the source in a text editor: opens it if `focus`, otherwise only syncs an already visible one. */
    private async revealSource([index, start, end]: Src, focus: boolean): Promise<void> {
        const source = this.sources[index];
        if (!source) return;
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(source));
        const visible = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());
        const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
        // Put the cursor at the start so the selection echo hits the same node
        const selection = new vscode.Selection(range.end, range.start);
        if (document.uri.toString() === this.document.uri.toString()) {
            this.ownSelection = `${selection.anchor.line}:${selection.anchor.character}-${selection.active.line}:${selection.active.character}`;
        }
        // A selection in the visual editor only syncs a visible text editor; opening one requires `focus`
        if (!visible && !focus) return;
        const editor = await vscode.window.showTextDocument(document, {
            viewColumn: visible?.viewColumn ?? vscode.ViewColumn.Beside, preserveFocus: !focus, selection
        });
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private post(message: ToStudio): void {
        // postMessage throws after the panel is disposed
        if (this.disposed) return;
        this.panel.webview.postMessage(message).then(undefined, () => undefined);
    }

    private html(): string {
        const webview = this.panel.webview;
        const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'studio', 'studio.js'));
        const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
        return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; media-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>html, body { margin: 0; padding: 0; height: 100%; }</style>
</head>
<body>
  <div id="studio"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.refreshTimer);
        this.disposables.splice(0).forEach(d => d.dispose());
    }
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** Whether the request was cancelled by client or server, or superseded by a newer change. */
function isCancellation(e: unknown): boolean {
    const code = (e as { code?: number } | undefined)?.code;
    return code === -32800 || code === -32801 || (e instanceof Error && /cancel/i.test(e.message));
}
