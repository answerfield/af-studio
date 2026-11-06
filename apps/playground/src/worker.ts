// Language worker: Langium services in memory, builds dev bundles for the preview and answers editor requests.
import { DocumentValidator, EmptyFileSystem, URI, type LangiumDocument } from 'langium';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { computeEdit, createItemServices, describeNode, EditError, loadBuiltinDocuments, paletteOf } from '@answerfield/language';
import { compileForEditor, registerCompilerChecks } from '@answerfield/compiler';
import type { CompletionResult, Diagnostics, EditResult, FromWorker, ToWorker, WorkerRequest } from './protocol.js';

const SYNTAX_CODES = new Set([DocumentValidator.LexingError, DocumentValidator.ParsingError]);
const KINDS: Record<number, string> = {
    2: 'method', 3: 'function', 5: 'property', 6: 'variable', 7: 'class', 9: 'namespace', 10: 'property',
    12: 'constant', 13: 'enum', 14: 'keyword', 15: 'text', 20: 'constant', 21: 'constant', 22: 'type', 25: 'type'
};

const scope = self as unknown as { postMessage(message: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const post = (message: FromWorker) => scope.postMessage(message);

const { shared, Item } = createItemServices(EmptyFileSystem);
registerCompilerChecks(Item);
const textDocuments = shared.workspace.TextDocuments;

let main = '';
/** Changed files not yet rebuilt. */
const dirty = new Set<string>();
/** The previewed file needs a new bundle. */
let stale = false;
/** Builds run one after another; requests wait for the current one. */
let building: Promise<void> = loadBuiltinDocuments(shared).then(() => undefined);

function schedule(): void {
    stale = true;
    building = building.then(build).catch(e => post({ kind: 'error', message: describe(e) }));
}

async function build(): Promise<void> {
    if (dirty.size > 0) {
        const changed = [...dirty].map(u => URI.parse(u));
        dirty.clear();
        await shared.workspace.DocumentBuilder.update(changed, []);
    }
    // More typing arrived meanwhile: the next build compiles
    if (dirty.size === 0 && stale) {
        stale = false;
        await compile();
    }
}

async function compile(): Promise<void> {
    const document = mainDocument();
    if (!document) return;
    const diagnostics = diagnosticsOf(document);
    const base = { kind: 'built', uri: main, version: document.textDocument.version, diagnostics } as const;
    try {
        post({ ...base, bundle: (await compileForEditor(Item, document)).bundle });
    } catch (e) {
        // Compiler crash: the preview keeps its last state, the editor still gets the diagnostics
        post(base);
        post({ kind: 'error', message: `Kompilieren fehlgeschlagen: ${describe(e)}` });
    }
}

function diagnosticsOf(document: LangiumDocument): Diagnostics {
    const list = (document.diagnostics ?? []).filter(d => d.severity === 1 || d.severity === 2);
    return {
        errors: list.filter(d => d.severity === 1).length,
        warnings: list.filter(d => d.severity === 2).length,
        syntax: list.filter(d => SYNTAX_CODES.has((d.data as { code?: string } | undefined)?.code ?? '')).length,
        list: list.map(d => ({
            severity: d.severity === 1 ? 'error' : 'warning',
            message: typeof d.message === 'string' ? d.message : d.message.value,
            start: document.textDocument.offsetAt(d.range.start),
            end: document.textDocument.offsetAt(d.range.end)
        }))
    };
}

function mainDocument(): LangiumDocument | undefined {
    const uri = URI.parse(main);
    return shared.workspace.LangiumDocuments.hasDocument(uri) ? shared.workspace.LangiumDocuments.getDocument(uri) : undefined;
}

function setText(uri: string, text: string, version: number): void {
    textDocuments.set(TextDocument.create(uri, 'af', version, text));
    dirty.add(uri);
}

async function answer(request: WorkerRequest): Promise<unknown> {
    await building;
    const document = mainDocument();
    if (!document) return null;
    const params = (offset: number) => ({ textDocument: { uri: main }, position: document.textDocument.positionAt(offset) });
    switch (request.kind) {
        case 'complete': {
            const list = await Item.lsp.CompletionProvider?.getCompletion(document, params(request.offset));
            if (!list) return null;
            let from = request.offset;
            const items = list.items.map(item => {
                const edit = item.textEdit && 'range' in item.textEdit ? item.textEdit : undefined;
                if (edit) from = document.textDocument.offsetAt(edit.range.start);
                const text = edit?.newText ?? item.insertText ?? item.label;
                const doc = typeof item.documentation === 'string' ? item.documentation : item.documentation?.value;
                return {
                    label: item.label,
                    apply: item.insertTextFormat === 2 ? plainSnippet(text) : text,
                    ...(item.detail ? { detail: item.detail } : {}),
                    ...(doc ? { info: doc } : {}),
                    ...(item.kind && KINDS[item.kind] ? { type: KINDS[item.kind] } : {})
                };
            });
            return { from, items } satisfies CompletionResult;
        }
        case 'hover': {
            const hover = await Item.lsp.HoverProvider?.getHoverContent(document, params(request.offset));
            const contents = hover?.contents;
            return contents && typeof contents === 'object' && 'value' in contents ? contents.value : null;
        }
        case 'describe':
            return describeNode(Item, document, request.node) ?? null;
        case 'palette':
            return paletteOf(Item, document.uri);
        case 'edit': {
            if (document.textDocument.version !== request.version) {
                return { ok: false, error: 'Der Text hat sich inzwischen geändert, bitte erneut versuchen.' } satisfies EditResult;
            }
            try {
                const result = computeEdit(Item, document, request.intent);
                return { ok: true, edits: result.edits, ...(result.select !== undefined ? { select: result.select } : {}) } satisfies EditResult;
            } catch (e) {
                if (e instanceof EditError) return { ok: false, error: e.message } satisfies EditResult;
                throw e;
            }
        }
    }
}

/** Snippet text without tab stops: `${1:x}` → `x`, `$0` → ''. */
function plainSnippet(text: string): string {
    return text.replace(/\$\{\d+:?([^}]*)\}/g, '$1').replace(/\$\d+/g, '');
}

function describe(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

scope.onmessage = ({ data: message }) => {
    switch (message.kind) {
        case 'open':
            for (const [uri, text] of Object.entries(message.files)) setText(uri, text, 0);
            main = message.main;
            schedule();
            break;
        case 'change':
            setText(message.uri, message.text, message.version);
            schedule();
            break;
        case 'main':
            main = message.uri;
            schedule();
            break;
        default: {
            const { id, ...request } = message;
            answer(request).then(
                result => post({ kind: 'reply', id, result }),
                e => { post({ kind: 'reply', id, result: null }); post({ kind: 'error', message: describe(e) }); }
            );
        }
    }
};
