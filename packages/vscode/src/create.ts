// "Neue Aufgabe" / "Neue Komponente": a new .af file in the chosen folder, filled by the language server's
// template (scaffold intent, so the template exists once) and opened in the visual editor.
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import { EDIT_REQUEST, type EditResponse } from './protocol.js';
import { EDITOR_VIEW_TYPE } from './editor.js';

/** Folder of an Explorer selection (a folder, or the folder of a file), else of the active editor or workspace. */
async function folderOf(uri: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
    const base = uri ?? vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!base || base.scheme !== 'file') return vscode.workspace.workspaceFolders?.[0]?.uri;
    const stat = await vscode.workspace.fs.stat(base).then(s => s, () => undefined);
    return stat?.type === vscode.FileType.Directory ? base : vscode.Uri.joinPath(base, '..');
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    return vscode.workspace.fs.stat(uri).then(() => true, () => false);
}

/** Creates the file, lets the server fill it once it knows the document, saves it and opens the AF editor. */
export async function createFile(client: LanguageClient, what: 'item' | 'component', target?: vscode.Uri): Promise<void> {
    const folder = await folderOf(target);
    if (!folder) {
        void vscode.window.showInformationMessage('Zuerst einen Ordner öffnen.');
        return;
    }
    const name = await vscode.window.showInputBox({
        title: what === 'item' ? 'Neue Aufgabe' : 'Neue Komponente',
        prompt: `Dateiname in ${vscode.workspace.asRelativePath(folder)}; daraus entsteht der Name der ${what === 'item' ? 'Aufgabe' : 'Komponente'}`,
        value: what === 'item' ? 'aufgabe' : 'Baustein',
        validateInput: async v => !/^[\p{L}\p{N}_ -]+$/u.test(v.trim()) ? 'Buchstaben, Ziffern, _ und - verwenden'
            : await exists(vscode.Uri.joinPath(folder, `${v.trim()}.af`)) ? 'Diese Datei gibt es schon' : undefined
    });
    if (!name) return;
    const uri = vscode.Uri.joinPath(folder, `${name.trim()}.af`);
    await vscode.workspace.fs.writeFile(uri, new Uint8Array());
    const document = await vscode.workspace.openTextDocument(uri);
    // The server learns about the document asynchronously: retry briefly until it answers
    let response: EditResponse | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
        response = await client.sendRequest<EditResponse>(EDIT_REQUEST, { uri: uri.toString(), version: document.version, intent: { kind: 'scaffold', what } })
            .catch(e => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
        if (response.ok || !/nicht gefunden/.test(response.error)) break;
        await new Promise(r => setTimeout(r, 150));
    }
    if (!response?.ok) {
        void vscode.window.showErrorMessage(`Vorlage nicht eingefügt: ${response?.error ?? 'keine Antwort'}`);
    } else {
        const edit = new vscode.WorkspaceEdit();
        edit.set(uri, response.edits.map(e => new vscode.TextEdit(
            new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText)));
        await vscode.workspace.applyEdit(edit);
        await document.save();
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, EDITOR_VIEW_TYPE);
}
