import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { computeEdit, createItemServices, describeNode, EditError, loadBuiltinDocuments, paletteOf, type ItemServices } from '@answerfield/language';
import { compileForEditor } from '@answerfield/compiler';
import { Studio, type FromStudio } from '../src/index.js';

/**
 * End-to-end without VS Code: studio in design mode, host backed by the real language services.
 * Intent → text edit → recompile → new bundle → selection preserved.
 */
let services: { shared: ReturnType<typeof createItemServices>['shared']; Item: ItemServices };

beforeAll(async () => {
    services = createItemServices(EmptyFileSystem);
    await loadBuiltinDocuments(services.shared);
    // happy-dom computes no layout: give every element a visible box
    HTMLElement.prototype.getBoundingClientRect = function () { return new DOMRect(10, 10, 200, 30); };
});

class TestHost {
    text: string;
    version = 1;
    document!: LangiumDocument;
    studio!: Studio;
    readonly uri = URI.parse('file:///test/designer.af');
    readonly selections: Array<[number, number, number]> = [];
    readonly edits: unknown[] = [];

    constructor(text: string) {
        this.text = text;
    }

    async start(): Promise<void> {
        document.body.innerHTML = '<div id="studio"></div>';
        this.studio = new Studio(document.getElementById('studio')!, { post: m => void this.receive(m) });
        await this.rebuild();
    }

    async rebuild(): Promise<void> {
        const { shared, Item } = services;
        if (shared.workspace.LangiumDocuments.hasDocument(this.uri)) await shared.workspace.DocumentBuilder.update([], [this.uri]);
        this.document = shared.workspace.LangiumDocumentFactory.fromString(this.text, this.uri);
        shared.workspace.LangiumDocuments.addDocument(this.document);
        await shared.workspace.DocumentBuilder.build([this.document], { validation: true });
        const { bundle } = await compileForEditor(Item, this.document);
        this.studio.receive({ kind: 'bundle', bundle, uri: this.uri.toString(), version: this.version, diagnostics: { errors: 0, warnings: 0, syntax: 0, list: [] } });
    }

    private async receive(message: FromStudio): Promise<void> {
        switch (message.kind) {
            case 'describe':
                this.studio.receive({ kind: 'reply', requestId: message.requestId, result: describeNode(services.Item, this.document, message.node) ?? null });
                break;
            case 'palette':
                this.studio.receive({ kind: 'reply', requestId: message.requestId, result: paletteOf(services.Item) });
                break;
            case 'edit': {
                this.edits.push(message.intent);
                if (message.version !== this.version) {
                    this.studio.receive({ kind: 'reply', requestId: message.requestId, result: { ok: false, error: 'veraltet' } });
                    return;
                }
                try {
                    const result = computeEdit(services.Item, this.document, message.intent);
                    this.text = TextDocument.applyEdits(this.document.textDocument, result.edits);
                    this.version++;
                    await this.rebuild();
                    this.studio.receive({ kind: 'reply', requestId: message.requestId, result: { ok: true, select: result.select } });
                    await this.rebuild(); // as in VS Code: validation runs after the reply
                } catch (e) {
                    this.studio.receive({ kind: 'reply', requestId: message.requestId, result: { ok: false, error: e instanceof EditError ? e.message : String(e) } });
                }
                break;
            }
            case 'select':
                this.selections.push(message.src);
                break;
        }
    }
}

async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
}

const FRACTION2 = readFileSync(join(__dirname, 'fixtures/fraction2.af'), 'utf8');

let host: TestHost;

beforeEach(async () => {
    host = new TestHost(FRACTION2);
    await host.start();
    host.studio.setMode('design');
    await settle();
});

describe('Designer', () => {
    test('Design-Modus: Aufgabe ist inert, Eigenschaften sind sichtbar', () => {
        expect((document.querySelector('af-root') as HTMLElement).inert).toBe(true);
        expect(document.querySelector('.studio-properties')!.hasAttribute('hidden')).toBe(false);
        expect(document.querySelector('.designer-layer')).not.toBeNull();
    });

    test('Erfolgskriterium 2: parts 8 → 12 über das Formular, Text und Vorschau folgen', async () => {
        host.studio.receive({ kind: 'reveal', offset: host.text.indexOf('shading =') + 2 });
        await settle();
        expect(document.querySelector('.designer-properties h3')!.textContent).toBe('FractionShading · shading');
        const parts = document.querySelector<HTMLInputElement>('[data-field="parts"]')!;
        expect(parts.value).toBe('8');

        parts.value = '12';
        parts.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await settle();

        expect(host.text).toBe(FRACTION2.replace('parts: 8', 'parts: 12'));
        expect(document.querySelectorAll('af-toggle')).toHaveLength(12);
        // selection and properties panel stay on the node
        expect(document.querySelector('.designer-properties h3')!.textContent).toBe('FractionShading · shading');
        expect(document.querySelector<HTMLInputElement>('[data-field="parts"]')!.value).toBe('12');
    });

    test('Enter und anschließendes Verlassen des Felds ergeben genau eine Änderung', async () => {
        host.studio.receive({ kind: 'reveal', offset: host.text.indexOf('shading =') + 2 });
        await settle();
        const parts = document.querySelector<HTMLInputElement>('[data-field="parts"]')!;
        parts.value = '10';
        parts.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        parts.dispatchEvent(new Event('change'));
        await settle();
        expect(host.edits).toHaveLength(1);
        expect(host.text).toContain('parts: 10');
        expect(document.querySelector('.designer-error')?.textContent ?? '').toBe('');
    });

    test('ungültige Eingaben werden im Formular abgefangen', async () => {
        host.studio.receive({ kind: 'reveal', offset: host.text.indexOf('shading =') + 2 });
        await settle();
        const parts = document.querySelector<HTMLInputElement>('[data-field="parts"]')!;
        parts.value = 'acht';
        parts.dispatchEvent(new Event('change'));
        await settle();
        expect(host.text).toBe(FRACTION2);
        expect(parts.parentElement!.querySelector('.designer-error')!.textContent).toMatch(/Zahl oder Bruch/);
    });

    test('Tastatur: Tab wählt, Pfeil hoch geht zum übergeordneten Knoten, Entf löscht', async () => {
        const preview = document.querySelector<HTMLElement>('.studio-preview')!;
        const key = (k: string) => preview.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        key('Tab');                                   // item
        key('Tab');                                   // page
        key('Tab');                                   // section
        key('Tab');                                   // p "Färbe …"
        await settle();
        expect(document.querySelector('.designer-label')!.textContent).toBe('p');
        expect(host.selections.at(-1)).toEqual([0, host.text.indexOf('p "Färbe'), host.text.indexOf('p "Färbe') + 'p "Färbe 3/4 des Kreises ein."'.length]);
        key('ArrowUp');
        await settle();
        expect(document.querySelector('.designer-label')!.textContent).toBe('section');
        key('ArrowDown');
        key('Delete');
        await settle();
        expect(host.text).not.toContain('Färbe 3/4');
        expect(host.text).toContain('shading = FractionShading');
    });

    test('Liste bearbeiten erzeugt eine Listenschreibweise', async () => {
        host = new TestHost(`item l1 { page { pick = Choice(label: "Welche?", options: ["a", "b"]) } }`);
        await host.start();
        host.studio.setMode('design');
        host.studio.receive({ kind: 'reveal', offset: host.text.indexOf('pick') });
        await settle();
        const add = [...document.querySelectorAll<HTMLButtonElement>('.designer-list button')].find(b => b.textContent === '+ Eintrag')!;
        add.click();
        await settle();
        expect(host.text).toBe(`item l1 { page { pick = Choice(label: "Welche?", options: ["a", "b", "Neu"]) } }`);
        expect(document.querySelectorAll('af-toggle')).toHaveLength(3);
    });

    test('Aufgabe ist auswählbar: Titel im Formular, Pfeil hoch von der Seite', async () => {
        const preview = document.querySelector<HTMLElement>('.studio-preview')!;
        preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        await settle();
        expect(document.querySelector('.designer-label')!.textContent).toBe('item');
        const title = document.querySelector<HTMLInputElement>('[data-field="#title"]')!;
        expect(title.value).toBe('Anteile färben');
        title.value = 'Anteile einfärben';
        title.dispatchEvent(new Event('change'));
        await settle();
        expect(host.text).toContain('item fraction2 "Anteile einfärben" {');
    });

    test('Prüfhinweise erscheinen als Markierung am Knoten und im Formular', async () => {
        const start = host.text.indexOf('p "Färbe');
        const { bundle } = await compileForEditor(services.Item, host.document);
        host.studio.receive({ kind: 'bundle', bundle, uri: host.uri.toString(), version: host.version,
            diagnostics: { errors: 0, warnings: 1, syntax: 0, list: [{ severity: 'warning', message: 'Testhinweis', start, end: start + 5 }] } });
        await settle();
        const badge = document.querySelector<HTMLElement>('.designer-badge.warning')!;
        expect(badge.textContent).toBe('1');
        expect(badge.title).toBe('Testhinweis');
        host.studio.receive({ kind: 'reveal', offset: start + 1 });
        await settle();
        expect(document.querySelector('.designer-diagnostics')!.textContent).toBe('Testhinweis');
    });

    test('Pfad erreicht show ohne eigene Fläche; Bedingung im Formular ändern', async () => {
        const source = readFileSync(join(__dirname, 'fixtures/fraction1.af'), 'utf8');
        host = new TestHost(source);
        await host.start();
        host.studio.setMode('design');
        host.studio.receive({ kind: 'reveal', offset: host.text.indexOf('reasoning =') });
        await settle();
        const path = () => [...document.querySelectorAll('.designer-path button')].map(b => b.textContent);
        expect(path()).toEqual(['item', 'page', 'show', 'section', 'FreeText · reasoning']);

        [...document.querySelectorAll<HTMLButtonElement>('.designer-path button')].find(b => b.textContent === 'show')!.click();
        await settle();
        expect(document.querySelector('.designer-label')!.textContent).toBe('show');
        expect(path()).toEqual(['item', 'page', 'show']);
        const condition = document.querySelector<HTMLInputElement>('[data-field="when"]')!;
        expect(condition.value).toBe('greater == {"3/5"}');
        condition.value = 'greater == {1, 2}';
        condition.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await settle();
        expect(host.text).toContain('show(when: greater == {1, 2}) {');
    });

    test('zurück in den Vorschau-Modus: Aufgabe wieder bedienbar', () => {
        host.studio.setMode('preview');
        expect((document.querySelector('af-root') as HTMLElement).inert).toBe(false);
        expect(document.querySelector('.designer-layer')).toBeNull();
    });

    test('Palette: Bausteine aus der Sprache, Klick fügt an der Auswahl ein', async () => {
        const groups = [...document.querySelectorAll('.designer-palette-group summary')].map(s => s.textContent);
        expect(groups.slice(0, 3)).toEqual(['Aufgabentypen', 'Text und Aufbau', 'Ablauf und Medien']);
        host.studio.receive({ kind: 'reveal', offset: host.text.indexOf('p "Färbe') + 1 });
        await settle();
        document.querySelector<HTMLButtonElement>('.designer-palette-entry[data-entry="Gap"]')!.click();
        await settle();
        expect(host.text).toContain('p "Färbe 3/4 des Kreises ein."\n      gap = Gap(label: "Lücke")');
        expect(document.querySelector('.designer-label')!.textContent).toBe('Gap · gap');
        expect(document.querySelector('.designer-palette-status')!.textContent).toBe('Gap eingefügt.');
        // search filters
        const search = document.querySelector<HTMLInputElement>('.designer-palette input[type="search"]')!;
        search.value = 'polyg';
        search.dispatchEvent(new Event('input'));
        expect([...document.querySelectorAll('.designer-palette-entry')].map(b => b.textContent)).toEqual(['polygon']);
    });

    test('Ablegen aus der Palette und Verschieben per Ziehen', async () => {
        host = new TestHost(`item dd1 {\n  page {\n    p "eins"\n    p "zwei"\n  }\n}`);
        await host.start();
        host.studio.setMode('design');
        await settle();
        // layout: each node on its own line
        const rows = new Map([...document.querySelectorAll<HTMLElement>('[data-node]')].map((n, i) => [n, i]));
        const rect = function (this: HTMLElement) {
            if (this.tagName === 'AF-ROOT' || this.tagName === 'AF-PAGE' || this.classList.contains('studio-preview')) return new DOMRect(0, 0, 400, 300);
            const i = rows.get(this) ?? 0;
            return new DOMRect(10, i * 40, 300, 30);
        };
        HTMLElement.prototype.getBoundingClientRect = rect;
        const designer = (host.studio as unknown as { designer: { dropAt(d: object, x: number, y: number): Promise<void> } }).designer;
        const p2 = [...document.querySelectorAll<HTMLElement>('af-p')][1];
        const r2 = p2.getBoundingClientRect();
        await designer.dropAt({ entry: 'p' }, r2.left + 5, r2.top + 2);   // upper half of "zwei" → before
        await settle();
        expect(host.text).toBe(`item dd1 {\n  page {\n    p "eins"\n    p "Text"\n    p "zwei"\n  }\n}`);
        HTMLElement.prototype.getBoundingClientRect = function () { return new DOMRect(10, 10, 200, 30); };
    });

    test('Text in der Vorschau tippen: Doppelklick öffnet ein Feld, Enter übernimmt, Esc verwirft', async () => {
        const p = [...document.querySelectorAll<HTMLElement>('af-p')].find(e => e.textContent!.includes('Färbe'))!;
        p.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 50, clientY: 20 }));
        await settle();
        let field = document.querySelector<HTMLTextAreaElement>('.designer-tools .designer-inline')!;
        expect(field.value).toBe('Färbe 3/4 des Kreises ein.');
        field.value = 'Färbe drei Viertel ein.';
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await settle();
        expect(host.text).toContain('p "Färbe drei Viertel ein."');
        const again = [...document.querySelectorAll<HTMLElement>('af-p')].find(e => e.textContent!.includes('Färbe'))!;
        again.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 50, clientY: 20 }));
        await settle();
        field = document.querySelector<HTMLTextAreaElement>('.designer-tools .designer-inline')!;
        field.value = 'verworfen';
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await settle();
        expect(host.text).not.toContain('verworfen');
    });

    test('Option einer Auswahl in der Vorschau umbenennen', async () => {
        host = new TestHost(`item it1 { page { pick = Choice(label: "Welche?", options: ["Hund", "Katze"]) } }`);
        await host.start();
        host.studio.setMode('design');
        host.studio.receive({ kind: 'reveal', offset: host.text.indexOf('pick') });
        await settle();
        const designer = (host.studio as unknown as { designer: { editText(el: HTMLElement, p?: object): Promise<void> } }).designer;
        // pointer over "Katze": only this element contains the point
        const cat = [...document.querySelectorAll<HTMLElement>('af-toggle')][1];
        HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
            return this === cat || cat.contains(this) ? new DOMRect(100, 100, 50, 20) : new DOMRect(10, 10, 80, 20);
        };
        await (designer as unknown as { editText(el: HTMLElement, p?: object): Promise<void> }).editText(document.querySelector<HTMLElement>('af-component[data-node]')!, { x: 110, y: 110 });
        const field = document.querySelector<HTMLTextAreaElement>('.designer-inline')!;
        expect(field.value).toBe('Katze');
        field.value = 'Maus';
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await settle();
        expect(host.text).toContain('options: ["Hund", "Maus"]');
        HTMLElement.prototype.getBoundingClientRect = function () { return new DOMRect(10, 10, 200, 30); };
    });

    test('Punkte in der Ebene: Griff je Punkt, Pfeiltaste und Enter setzen den Punkt im Text', async () => {
        host = new TestHost(`item g1 {\n  plane(x: 0 .. 8, y: 0 .. 6, grid: 1) {\n    dot(at: point(2, 1), label: "A")\n  }\n}`);
        await host.start();
        host.studio.setMode('design');
        host.studio.receive({ kind: 'reveal', offset: host.text.indexOf('dot(') + 1 });
        await settle();
        const handle = document.querySelector<HTMLButtonElement>('.designer-tools .designer-handle')!;
        expect(handle.getAttribute('aria-label')).toBe('A bei (2 | 1) – ziehen oder Pfeiltasten');
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await settle();
        expect(host.text).toContain('dot(at: (3 | 2), label: "A")');
    });

    test('Alt+Pfeil verschiebt, Duplizieren gibt neue Antwortnamen', async () => {
        host = new TestHost(`item k1 {\n  page {\n    p "eins"\n    a = Gap("x")\n  }\n}`);
        await host.start();
        host.studio.setMode('design');
        host.studio.receive({ kind: 'reveal', offset: host.text.indexOf('a = Gap') });
        await settle();
        const preview = document.querySelector<HTMLElement>('.studio-preview')!;
        preview.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
        await settle();
        expect(host.text).toBe(`item k1 {\n  page {\n    a = Gap("x")\n    p "eins"\n  }\n}`);
        [...document.querySelectorAll<HTMLButtonElement>('.designer-actions button')].find(b => b.textContent === 'Duplizieren')!.click();
        await settle();
        expect(host.text).toContain('a = Gap("x")\n    a2 = Gap("x")');
    });

    test('Tab verlässt die Vorschau am letzten Knoten; die Auswahl wird angesagt', async () => {
        const preview = document.querySelector<HTMLElement>('.studio-preview')!;
        const tab = (shift = false) => { const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }); preview.dispatchEvent(e); return e.defaultPrevented; };
        expect(tab()).toBe(true);
        await settle();
        expect(document.querySelector('.designer-announce')!.textContent).toMatch(/^item, 1 von \d+$/);
        expect(tab(true)).toBe(false);          // Shift+Tab at the start: leaves the preview
        let guard = 0;
        while (tab() && guard++ < 500) { /* until the last node */ }
        expect(guard).toBeLessThan(500);        // at the end, Tab releases focus
    });
});


describe('Bauen: leere Datei → Komponente → Bausteine darin', () => {
    test('Knopf „Komponente anlegen“, Palette fügt in die Komponente ein, Wurzel zeigt die Signatur', async () => {
        const empty = new TestHost('');
        await empty.start();
        await settle();
        const create = [...document.querySelectorAll<HTMLButtonElement>('.studio-empty button')].find(b => b.textContent === 'Komponente anlegen')!;
        expect(create).toBeDefined();
        create.click();
        await settle();
        expect(empty.text).toContain('component Designer(label: Content): response Text {');
        // design mode on the component's preview: the root carries the component's ID
        expect(document.querySelector<HTMLElement>('af-root')!.dataset.node).toBe('/elements@0');
        expect(document.querySelector('.studio-properties')!.hasAttribute('hidden')).toBe(false);
        // palette without a selection: into the component, as a call without a binding
        const gap = [...document.querySelectorAll<HTMLButtonElement>('.designer-palette-entry')].find(b => b.textContent === 'Gap')!;
        gap.click();
        await settle();
        expect(empty.text).toMatch(/  input\(bind: wert, label: label\)\n  Gap\(label: "Lücke"\)\n  response wert/);
        // the root (first part of the path) shows the signature
        document.querySelector<HTMLButtonElement>('.designer-path button')!.click();
        await settle();
        expect(document.querySelector('.designer-properties h3')!.textContent).toBe('component Designer');
        expect([...document.querySelectorAll('.designer-field label')].map(l => l.firstChild?.textContent)).toEqual(
            ['Beschreibung', 'Parameter', 'Antworttyp', 'Nimmt Inhalt (children)']);
    });
});
