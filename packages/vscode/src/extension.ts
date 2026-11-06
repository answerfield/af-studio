import * as path from 'node:path';
import * as vscode from 'vscode';
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node';
import { PRELUDE } from '@answerfield/language/prelude';
import { STD } from '@answerfield/stdlib';
import { AfEditorProvider, EDITOR_VIEW_TYPE, LANGUAGE_ID } from './editor.js';
import { VALIDATED_NOTIFICATION } from './protocol.js';
import { StructureProvider } from './structure.js';
import { createFile } from './create.js';
const BUILTIN_SCHEME = 'af-builtin';
/** Texts of the built-in libraries by file name: the prelude of the language and std.af from @answerfield/stdlib. */
const LIBRARIES: Readonly<Record<string, string>> = { 'prelude.af': PRELUDE, 'std.af': STD };

let client: LanguageClient | undefined;

/** API returned from `activate`, used by the integration tests. */
export interface AfExtensionApi {
    structure: StructureProvider;
}

/** Activates the extension: built-in library documents, language client, structure view and AF editor. */
export async function activate(context: vscode.ExtensionContext): Promise<AfExtensionApi> {
    // Serve the built-in libraries (prelude, std) read-only, e.g. for "Go to Definition".
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(BUILTIN_SCHEME, {
        provideTextDocumentContent: uri => LIBRARIES[path.posix.basename(uri.path)] ?? ''
    }));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
        if (document.uri.scheme === BUILTIN_SCHEME && document.languageId !== LANGUAGE_ID) {
            void vscode.languages.setTextDocumentLanguage(document, LANGUAGE_ID);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('af.openLibrary', async () => {
        const file = await vscode.window.showQuickPick(Object.keys(LIBRARIES), { placeHolder: 'Bibliothek öffnen' });
        if (file) {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(`${BUILTIN_SCHEME}:///${file}`));
            await vscode.window.showTextDocument(document, { preview: true });
        }
    }));

    const languageClient = startLanguageClient(context);
    client = languageClient;
    const structure = new StructureProvider();
    structure.view = vscode.window.createTreeView('af.structure', { treeDataProvider: structure, showCollapseAll: true });
    context.subscriptions.push(structure.view);
    const provider = new AfEditorProvider(context, languageClient, structure);
    context.subscriptions.push(vscode.commands.registerCommand('af.revealNode', (uri: vscode.Uri, range: vscode.Range) => provider.revealNode(uri, range)));

    // Show the "answerfield-Struktur" view for any active .af file, whether in a text editor or the AF editor
    const updateStructure = () => {
        const text = vscode.window.activeTextEditor;
        const textItem = text?.document.languageId === LANGUAGE_ID ? text.document.uri : undefined;
        if (!provider.isActive && textItem) structure.setDocument(textItem);
        void vscode.commands.executeCommand('setContext', 'af.structureAvailable', provider.isActive || textItem !== undefined);
    };
    context.subscriptions.push(
        provider.onDidChangeActive.event(updateStructure),
        vscode.window.onDidChangeActiveTextEditor(updateStructure),
        vscode.window.onDidChangeTextEditorSelection(e => {
            if (e.textEditor.document.languageId === LANGUAGE_ID) void structure.reveal(e.textEditor.document.uri, e.selections[0].active);
        })
    );
    updateStructure();
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(EDITOR_VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('af.openPreview', async (uri?: vscode.Uri) => {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) {
            void vscode.window.showInformationMessage('Zuerst eine .af-Datei öffnen.');
            return;
        }
        await vscode.commands.executeCommand('vscode.openWith', target, EDITOR_VIEW_TYPE, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    }));
    context.subscriptions.push(
        vscode.commands.registerCommand('af.newItem', (uri?: vscode.Uri) => createFile(languageClient, 'item', uri)),
        vscode.commands.registerCommand('af.newComponent', (uri?: vscode.Uri) => createFile(languageClient, 'component', uri))
    );
    context.subscriptions.push(languageClient.onNotification(VALIDATED_NOTIFICATION, (params: { uris?: string[] }) => provider.refreshAll(params?.uris)));
    // Start the server without waiting: VS Code waits for activation before it shows a restored AF editor, and requests
    // wait for the server anyway. The editor appears at once and fills when the first bundle arrives.
    languageClient.start().catch(e => languageClient.outputChannel.appendLine(`Sprachserver nicht gestartet: ${e instanceof Error ? e.message : String(e)}`));
    return { structure };
}

/** Stops the language client. */
export async function deactivate(): Promise<void> {
    await client?.stop();
}

function startLanguageClient(context: vscode.ExtensionContext): LanguageClient {
    const serverModule = context.asAbsolutePath(path.join('out', 'server.cjs'));
    // Attach the inspector to the server only on request (AF_DEBUG_SERVER=1)
    const inspect = process.env.AF_DEBUG_SERVER ? { execArgv: ['--nolazy', `--inspect${process.env.DEBUG_BREAK ? '-brk' : ''}=${process.env.DEBUG_SOCKET || '6009'}`] } : undefined;
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, ...(inspect ? { options: inspect } : {}) }
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: LANGUAGE_ID },
            { scheme: 'untitled', language: LANGUAGE_ID },
            { scheme: BUILTIN_SCHEME, language: LANGUAGE_ID }
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.af')
        }
    };
    return new LanguageClient(LANGUAGE_ID, 'answerfield', serverOptions, clientOptions);
}
