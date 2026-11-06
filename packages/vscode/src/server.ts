// Language server: Langium services plus dev bundles and edits for the preview and the visual editor.
import { DocumentState, DocumentValidator, URI, type LangiumDocument } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { computeEdit, createItemServices, describeNode, EditError, paletteOf } from '@answerfield/language';
import { compileForEditor, registerCompilerChecks } from '@answerfield/compiler';
import {
    DESCRIBE_REQUEST, DEV_BUNDLE_REQUEST, EDIT_REQUEST, PALETTE_REQUEST, VALIDATED_NOTIFICATION,
    type DescribeParams, type DescribeResponse, type PaletteParams, type PaletteResponse, type DevBundleParams, type DevBundleResult, type EditParams, type EditResponse
} from './protocol.js';

const SYNTAX_CODES = new Set([DocumentValidator.LexingError, DocumentValidator.ParsingError]);

const connection = createConnection(ProposedFeatures.all);
const { shared, Item } = createItemServices({ connection, ...NodeFileSystem });
registerCompilerChecks(Item);
startLanguageServer(shared);

// A single error must not kill the server: Node exits on unhandled errors, and VS Code gives up after five restarts.
process.on('unhandledRejection', reason => connection.console.error(`Unbehandelter Fehler: ${describe(reason)}`));
process.on('uncaughtException', error => connection.console.error(`Unbehandelte Ausnahme: ${describe(error)}`));

function describe(e: unknown): string {
    return e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
}

async function validated(uri: string): Promise<LangiumDocument | undefined> {
    const parsed = URI.parse(uri);
    if (!shared.workspace.LangiumDocuments.hasDocument(parsed)) return undefined;
    await shared.workspace.DocumentBuilder.waitUntil(DocumentState.Validated, parsed);
    return shared.workspace.LangiumDocuments.getDocument(parsed);
}

connection.onRequest(DEV_BUNDLE_REQUEST, async ({ uri }: DevBundleParams): Promise<DevBundleResult | null> => {
    const document = await validated(uri);
    if (!document) return null;
    let bundle, documents: string[];
    try {
        ({ bundle, documents } = await compileForEditor(Item, document));
    } catch (e) {
        // Compiler crash: the preview keeps its last state; details go to the output channel
        connection.console.error(`Dev-Bundle für ${uri} fehlgeschlagen: ${describe(e)}`);
        return null;
    }
    const diagnostics = (document.diagnostics ?? []).filter(d => d.severity === 1 || d.severity === 2);
    return {
        bundle,
        version: document.textDocument.version,
        documents,
        diagnostics: {
            errors: diagnostics.filter(d => d.severity === 1).length,
            warnings: diagnostics.filter(d => d.severity === 2).length,
            syntax: diagnostics.filter(d => SYNTAX_CODES.has((d.data as { code?: string } | undefined)?.code ?? '')).length,
            list: diagnostics.map(d => ({
                severity: d.severity === 1 ? 'error' : 'warning',
                message: typeof d.message === 'string' ? d.message : d.message.value,
                start: document.textDocument.offsetAt(d.range.start),
                end: document.textDocument.offsetAt(d.range.end)
            }))
        }
    };
});

connection.onRequest(EDIT_REQUEST, async ({ uri, version, intent }: EditParams): Promise<EditResponse> => {
    const document = await validated(uri);
    if (!document) return { ok: false, error: 'Dokument nicht gefunden.' };
    if (document.textDocument.version !== version) {
        return { ok: false, error: 'Das Dokument hat sich inzwischen geändert – bitte erneut versuchen.' };
    }
    try {
        const result = computeEdit(Item, document, intent);
        return { ok: true, edits: result.edits, ...(result.select !== undefined ? { select: result.select } : {}) };
    } catch (e) {
        if (e instanceof EditError) return { ok: false, error: e.message };
        connection.console.error(`Bearbeitung fehlgeschlagen: ${describe(e)}`);
        return { ok: false, error: 'Interner Fehler bei der Bearbeitung (Details im Ausgabefenster „answerfield“).' };
    }
});

connection.onRequest(DESCRIBE_REQUEST, async ({ uri, node }: DescribeParams): Promise<DescribeResponse> => {
    const document = await validated(uri);
    try {
        return document ? describeNode(Item, document, node) ?? null : null;
    } catch (e) {
        connection.console.error(`Beschreibung von ${node} fehlgeschlagen: ${describe(e)}`);
        return null;
    }
});

connection.onRequest(PALETTE_REQUEST, async ({ uri }: PaletteParams): Promise<PaletteResponse> => {
    await shared.workspace.WorkspaceManager.ready;
    return paletteOf(Item, uri ? URI.parse(uri) : undefined);
});

shared.workspace.DocumentBuilder.onBuildPhase(DocumentState.Validated, documents => {
    void connection.sendNotification(VALIDATED_NOTIFICATION, { uris: documents.map(d => d.uri.toString()) });
});
