// Playground: AF source on the left (CodeMirror), the studio preview on the right (iframe), the language in a worker.
import { autocompletion, type CompletionContext, type CompletionResult as CmCompletionResult } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, hoverTooltip } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import type { Bundle } from '@answerfield/bundle';
import type { FromStudio, ToStudio } from '@answerfield/studio-ui/protocol';
import { afLanguage } from './highlight.js';
import type { CompletionResult, Diagnostics, EditResult, FromWorker, ToWorker, WorkerRequest } from './protocol.js';

interface Examples {
    groups: Array<{ label: string; folder: string; files: Array<{ name: string; title: string; text: string }> }>;
}

const SCHEME = 'inmemory:///examples/';
const select = document.getElementById('example') as HTMLSelectElement;
const reset = document.getElementById('reset') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLElement;
const frame = document.getElementById('preview') as HTMLIFrameElement;

const worker = new Worker('worker.js');
const originals = new Map<string, string>();
/** Editor state per file, so switching keeps undo history and cursor. */
const states = new Map<string, EditorState>();
const versions = new Map<string, number>();
let version = 0;
let main = '';
let bundle: { uri: string; version: number; bundle: Bundle; diagnostics: Diagnostics } | undefined;
let studioReady = false;

// Worker requests

let nextId = 0;
const pending = new Map<number, (result: unknown) => void>();

function request<T>(message: WorkerRequest): Promise<T> {
    const id = ++nextId;
    return new Promise(resolve => {
        pending.set(id, resolve as (result: unknown) => void);
        post({ id, ...message });
    });
}

function post(message: ToWorker): void {
    worker.postMessage(message);
}

worker.onmessage = ({ data: message }: MessageEvent<FromWorker>) => {
    switch (message.kind) {
        case 'reply':
            pending.get(message.id)?.(message.result);
            pending.delete(message.id);
            break;
        case 'built':
            if (message.uri !== main) return;
            showDiagnostics(message.diagnostics, message.version);
            if (message.bundle) {
                bundle = { uri: message.uri, version: message.version, bundle: message.bundle, diagnostics: message.diagnostics };
                sendBundle();
            }
            break;
        case 'error':
            console.error(message.message);
            break;
    }
};

// Editor

/** Editor colors from the page's tokens, so light and dark mode follow the page. */
const theme = EditorView.theme({
    '&': { color: 'var(--fg)', backgroundColor: 'var(--bg)' },
    '.cm-content': { caretColor: 'var(--fg)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
    '.cm-gutters': { color: 'var(--muted)', backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)' },
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
    '.cm-tooltip': { color: 'var(--fg)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { color: '#fff', backgroundColor: 'var(--accent)' },
    '.cm-panels': { color: 'var(--fg)', backgroundColor: 'var(--surface)' }
});

const extensions = [
    basicSetup,
    theme,
    afLanguage,
    lintGutter(),
    autocompletion({ override: [complete] }),
    hoverTooltip(hover),
    EditorView.updateListener.of(update => {
        if (update.docChanged) {
            versions.set(main, ++version);
            post({ kind: 'change', uri: main, text: update.state.doc.toString(), version });
        }
        if (update.selectionSet && !update.docChanged && bundle?.version === versions.get(main)) {
            toStudio({ kind: 'reveal', offset: update.state.selection.main.head });
        }
    })
];

const view = new EditorView({ parent: document.getElementById('editor')!, state: EditorState.create({ extensions }) });

async function complete(context: CompletionContext): Promise<CmCompletionResult | null> {
    const word = context.matchBefore(/\w*/);
    if (!context.explicit && (!word || word.from === word.to)) return null;
    const result = await request<CompletionResult | null>({ kind: 'complete', offset: context.pos });
    if (!result || context.aborted) return null;
    return {
        from: Math.min(result.from, context.pos),
        options: result.items.map(i => ({ label: i.label, apply: i.apply, detail: i.detail, type: i.type, info: i.info && (() => markdownNode(i.info!)) })),
        validFor: /^\w*$/
    };
}

async function hover(_view: EditorView, pos: number) {
    const markdown = await request<string | null>({ kind: 'hover', offset: pos });
    if (!markdown) return null;
    return {
        pos,
        create: () => ({ dom: markdownNode(markdown) })
    };
}

function showDiagnostics(diagnostics: Diagnostics, at: number): void {
    if (at !== versions.get(main)) return;
    const length = view.state.doc.length;
    const list: Diagnostic[] = diagnostics.list.map(d => ({
        from: Math.min(d.start, length), to: Math.min(d.end, length), severity: d.severity, message: d.message
    }));
    view.dispatch(setDiagnostics(view.state, list));
    status.textContent = diagnostics.errors || diagnostics.warnings
        ? `${diagnostics.errors} Fehler, ${diagnostics.warnings} Warnungen`
        : 'Keine Probleme';
    status.dataset.state = diagnostics.errors ? 'error' : diagnostics.warnings ? 'warning' : 'ok';
}

function openFile(uri: string): void {
    if (uri === main) return;
    if (main) states.set(main, view.state);
    main = uri;
    view.setState(states.get(uri) ?? EditorState.create({ doc: originals.get(uri) ?? '', extensions }));
    select.value = uri;
    bundle = undefined;
    post({ kind: 'main', uri });
}

/** Restores the original text of the current file (as one undoable change). */
function resetFile(): void {
    const text = originals.get(main);
    if (text !== undefined && text !== view.state.doc.toString()) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    }
}

// Studio (preview and designer)

function toStudio(message: ToStudio): void {
    if (studioReady) frame.contentWindow?.postMessage(message, '*');
}

function sendBundle(): void {
    if (!bundle) return;
    const folder = bundle.uri.slice(SCHEME.length, bundle.uri.lastIndexOf('/') + 1);
    toStudio({
        kind: 'bundle', bundle: bundle.bundle, uri: bundle.uri, version: bundle.version, diagnostics: bundle.diagnostics,
        baseUrl: new URL(`examples/${folder}`, location.href).toString()
    });
}

window.addEventListener('message', (e: MessageEvent<FromStudio>) => {
    if (e.source !== frame.contentWindow || !e.data || typeof e.data !== 'object') return;
    void fromStudio(e.data);
});
// Load the studio only now: it reports 'ready' once, and a cached studio.js could do so before this listener exists
frame.src = 'studio.html';

async function fromStudio(message: FromStudio): Promise<void> {
    switch (message.kind) {
        case 'ready':
            studioReady = true;
            sendBundle();
            break;
        case 'select': {
            const [index, start, end] = message.src;
            const uri = bundle?.bundle.sources?.[index];
            if (!uri || !originals.has(uri)) return;
            openFile(uri);
            const length = view.state.doc.length;
            view.dispatch({ selection: EditorSelection.range(Math.min(end, length), Math.min(start, length)), scrollIntoView: true });
            if (message.focus ?? true) view.focus();
            break;
        }
        case 'describe':
            toStudio({ kind: 'reply', requestId: message.requestId, result: await request({ kind: 'describe', node: message.node }) });
            break;
        case 'palette':
            toStudio({ kind: 'reply', requestId: message.requestId, result: await request({ kind: 'palette' }) ?? [] });
            break;
        case 'edit': {
            const result = await request<EditResult | null>({ kind: 'edit', version: message.version, intent: message.intent });
            toStudio({ kind: 'reply', requestId: message.requestId, result: applyEdit(message.version, result) });
            break;
        }
    }
}

/** Applies the text edits of a designer intent, unless the text changed meanwhile. */
function applyEdit(at: number, result: EditResult | null) {
    if (!result) return { ok: false, error: 'Interner Fehler bei der Bearbeitung.' };
    if (!result.ok) return result;
    if (versions.get(main) !== at) return { ok: false, error: 'Der Text hat sich inzwischen geändert, bitte erneut versuchen.' };
    const doc = view.state.doc;
    const offset = (p: { line: number; character: number }) => doc.line(p.line + 1).from + p.character;
    view.dispatch({ changes: result.edits.map(e => ({ from: offset(e.range.start), to: offset(e.range.end), insert: e.newText })) });
    return { ok: true, ...(result.select !== undefined ? { select: result.select } : {}) };
}

// Hover and completion docs: Markdown subset of Langium's hovers (code blocks, rules, lists, inline code, emphasis)

function renderMarkdown(text: string): string {
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s: string) => escape(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    const blocks = (part: string) => part.split(/\n\s*\n|\n(?=---\s*$)|(?<=^---)\n/m).map(block => {
        const lines = block.trim().split('\n');
        if (!lines[0]) return '';
        if (lines.length === 1 && /^-{3,}$/.test(lines[0])) return '<hr>';
        if (lines.every(l => /^\s*[-*] /.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
        return `<p>${inline(block.trim())}</p>`;
    }).join('');
    return text.split(/(```[\s\S]*?```)/).map(part => part.startsWith('```')
        ? `<pre>${escape(part.replace(/^```\w*\n?/, '').replace(/```$/, ''))}</pre>`
        : blocks(part)
    ).join('');
}

function markdownNode(text: string): HTMLElement {
    const dom = document.createElement('div');
    dom.className = 'af-hover';
    dom.innerHTML = renderMarkdown(text);
    return dom;
}

// Start

async function start(): Promise<void> {
    const examples = await (await fetch('examples.json')).json() as Examples;
    for (const group of examples.groups) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.label;
        for (const file of group.files) {
            const uri = `${SCHEME}${group.folder}/${file.name}`;
            originals.set(uri, file.text);
            versions.set(uri, 0);
            optgroup.append(new Option(file.title, uri));
        }
        select.append(optgroup);
    }
    const first = new URLSearchParams(location.search).get('example');
    const initial = [...originals.keys()].find(u => first && u.endsWith(`/${first}`)) ?? originals.keys().next().value!;
    post({ kind: 'open', files: Object.fromEntries(originals), main: initial });
    openFile(initial);
    select.addEventListener('change', () => openFile(select.value));
    reset.addEventListener('click', resetFile);
}

void start();
