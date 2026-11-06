// Runs in the extension host. Tests the "answerfield-Struktur" view with the AF editor.
const vscode = require('vscode');
const path = require('path');
const assert = require('assert');

const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, what, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        const value = await check();
        if (value) return value;
        await wait(200);
    }
    throw new Error(`Zeitüberschreitung: ${what}`);
}

exports.run = async function () {
    const ext = vscode.extensions.all.find(e => e.id.endsWith('af-vscode'));
    const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const uri = vscode.Uri.file(path.join(folder, 'basic/fractions/fraction1.af'));

    // 1. Open the text, then the AF editor beside it as with ⌘K V
    await vscode.window.showTextDocument(uri);
    const api = await until(async () => { if (!ext.isActive) await ext.activate(); return ext.exports; }, 'Aktivierung');
    await vscode.commands.executeCommand('af.openPreview');
    await wait(1500);
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => ({ label: t.label, custom: t.input instanceof vscode.TabInputCustom, active: t.isActive && g.isActive })));
    console.log('Tabs nach ⌘K V:', JSON.stringify(tabs));
    console.log('Struktur-Dokument nach ⌘K V:', api.structure.uri?.fsPath ?? '(keins)');
    assert.strictEqual(api.structure.uri?.fsPath, uri.fsPath, 'Struktur folgt schon dem Texteditor');

    // 2. Switch to the AF editor (like clicking into it)
    await vscode.commands.executeCommand('workbench.action.focusNextGroup');
    await wait(800);
    console.log('Aktiver Tab:', vscode.window.tabGroups.activeTabGroup.activeTab?.label,
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom ? '(answerfield-Editor)' : '');
    console.log('Struktur-Dokument nach Fokus:', api.structure.uri?.fsPath ?? '(keins)');
    assert.strictEqual(api.structure.uri?.fsPath, uri.fsPath, 'Struktur im answerfield-Editor');

    const roots = await until(async () => {
        const r = api.structure.getChildren();
        return r.length > 0 ? r : undefined;
    }, 'Baum');
    const print = (nodes, d = 0) => nodes.flatMap(n => [`${'  '.repeat(d)}${n.symbol.name}`, ...print(n.children, d + 1)]);
    const lines = print(roots);
    console.log(lines.slice(0, 10).join('\n'));
    assert.ok(lines.some(l => l.trim() === 'show'), 'show fehlt im Baum');
    console.log('INTEGRATION OK');
};
