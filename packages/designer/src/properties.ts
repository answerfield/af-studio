import type { DiagnosticInfo, EditIntent, EditOutcome, NodeDescription, ParamDescription } from './protocol.js';
import { el } from './dom.js';

/** Callbacks of the {@link PropertiesPanel}. */
export interface PropertiesCallbacks {
    /** Applies an edit to the source text. */
    edit(intent: EditIntent): Promise<EditOutcome>;
    /** Deletes the selected node. */
    remove(): void;
    /** Reveals the selected node in the text editor. */
    showSource(): void;
    /** Extra actions offered by the node description (duplicate, add column, extract a component). */
    action?(kind: 'duplicate' | 'addColumn' | 'extract'): void;
}

type ListItem = { kind: 'text' | 'number' | 'expression'; value: string };

const NUMBER = /^-?\d+(\.\d+)?(\s*\/\s*\d+)?$/;
const SIZE = /^\d+(\.\d+)?(em|rem|px|ch|%)$/;

/**
 * Properties panel generated from the signature of the selected node.
 * Each commit (Enter, leaving a field, picking an option) is exactly one text edit.
 */
export class PropertiesPanel {
    constructor(private readonly container: HTMLElement, private readonly callbacks: PropertiesCallbacks) {
        container.classList.add('designer-properties');
        this.renderEmpty();
    }

    /** Renders the form for a node description with its own diagnostics; `undefined` shows an empty state. */
    show(description: NodeDescription | undefined, diagnostics: DiagnosticInfo[] = []): void {
        // Keep focus when the same node is described again after a rebuild
        const focused = this.container.ownerDocument.activeElement as HTMLElement | null;
        const focusKey = this.container.contains(focused) ? focused?.dataset.field : undefined;
        if (!description) {
            this.renderEmpty();
            return;
        }
        const doc = this.container.ownerDocument;
        const actions = el(doc, 'div', { class: 'designer-actions' }, this.button('Im Text zeigen', () => this.callbacks.showSource()));
        if (description.actions?.includes('duplicate')) actions.append(this.button('Duplizieren', () => this.callbacks.action?.('duplicate')));
        if (description.actions?.includes('addColumn')) actions.append(this.button('Spalte hinzufügen', () => this.callbacks.action?.('addColumn')));
        if (description.actions?.includes('extract')) actions.append(this.button('Als Komponente herausziehen', () => this.callbacks.action?.('extract')));
        if (description.removable) actions.append(this.button('Entfernen', () => this.callbacks.remove(), 'danger'));
        const title = description.binding ? `${description.label} · ${description.binding}` : description.label;

        const parts: HTMLElement[] = [el(doc, 'header', {}, el(doc, 'h3', { text: title }), actions)];
        if (description.doc) parts.push(el(doc, 'p', { class: 'designer-doc', text: description.doc }));
        if (diagnostics.length > 0) {
            parts.push(el(doc, 'ul', { class: 'designer-diagnostics' }, ...diagnostics.map(d => el(doc, 'li', { class: d.severity, text: d.message }))));
        }
        if (description.params.length === 0) parts.push(el(doc, 'p', { class: 'designer-muted', text: 'Keine Eigenschaften.' }));
        for (const param of description.params) parts.push(this.field(description, param));
        this.container.replaceChildren(...parts);
        if (focusKey) this.container.querySelector<HTMLElement>(`[data-field="${CSS.escape(focusKey)}"]`)?.focus();
    }

    /** Focuses the first field (Enter in the overlay). */
    focusFirst(): void {
        this.container.querySelector<HTMLElement>('input, select, textarea, button.designer-add')?.focus();
    }

    // --- Fields -------------------------------------------------------------------------------

    private field(node: NodeDescription, param: ParamDescription): HTMLElement {
        const doc = this.container.ownerDocument;
        const id = `designer-${node.id}-${param.name}`.replace(/[^\w-]/g, '_');
        const label = el(doc, 'label', { text: param.label, attrs: { for: id } });
        if (param.required) label.append(el(doc, 'span', { class: 'designer-required', text: ' *', attrs: { title: 'Pflichtangabe' } }));
        label.append(el(doc, 'span', { class: 'designer-type', text: param.type }));

        const message = el(doc, 'div', { class: 'designer-error', attrs: { role: 'alert' } });
        const commit = async (intent: EditIntent | undefined, invalid?: string) => {
            message.textContent = invalid ?? '';
            if (!intent || invalid) return;
            const result = await this.callbacks.edit(intent);
            if (!result.ok) message.textContent = result.error ?? 'Änderung nicht möglich';
        };
        const set = (value: string) => ({ kind: 'setArgument', node: node.id, param: param.name, value }) as EditIntent;
        // Optional pseudo-parameters (doc, response type, coding) are cleared with an empty value
        const unset = param.required ? undefined
            : param.name.startsWith('#') ? (param.name === '#title' ? undefined : set(''))
            : { kind: 'removeArgument', node: node.id, param: param.name } as EditIntent;

        const control = this.control(param, id, set, unset, commit);
        control.dataset.field = param.name;
        const wrapper = el(doc, 'div', { class: 'designer-field' }, label, control, message);
        if (param.doc) wrapper.append(el(doc, 'div', { class: 'designer-help', text: param.doc }));
        return wrapper;
    }

    private control(
        param: ParamDescription, id: string,
        set: (value: string) => EditIntent, unset: EditIntent | undefined,
        commit: (intent: EditIntent | undefined, invalid?: string) => Promise<void>
    ): HTMLElement {
        const doc = this.container.ownerDocument;
        const value = param.value;
        const base = param.type.replace(/\?$/, '');
        const placeholder = param.default !== undefined ? `Standard: ${param.default}` : param.required ? '' : 'nicht gesetzt';

        // Expressions no form control can represent, and fields with suggested expressions (coding, type)
        if (value?.kind === 'expression' || param.suggestions) {
            return this.expressionField(id, value?.kind === 'expression' ? value.text : '', text => commit(text === '' ? unset : set(text)), param.suggestions);
        }

        if (param.enumValues || base === 'Bool') {
            const select = doc.createElement('select');
            select.id = id;
            const options = param.enumValues ?? ['true', 'false'];
            const current = value?.kind === 'enum' ? value.value : value?.kind === 'bool' ? String(value.value) : undefined;
            if (!param.required) {
                select.append(this.option(placeholder || 'nicht gesetzt', '', current === undefined, current === undefined));
            }
            for (const o of options) select.append(this.option(o, o, o === current, o === current));
            select.addEventListener('change', () => void commit(select.value === '' ? unset : set(select.value)));
            return select;
        }

        if (base.startsWith('List<')) {
            const numeric = base.includes('Rational') || base.includes('Int');
            return this.listField(id, param, value?.kind === 'list' ? value.items : [], numeric, param.newItem,
                items => commit(set(`[${items.map(i => i.kind === 'text' ? quote(i.value) : i.value).join(', ')}]`)));
        }

        if (base === 'Interval') {
            const [from, to] = value?.kind === 'interval' ? [value.from, value.to] : ['', ''];
            const a = this.input(id, from, 'von'), b = this.input(`${id}-to`, to, 'bis');
            const apply = () => {
                if (!NUMBER.test(a.value.trim()) || !NUMBER.test(b.value.trim())) return void commit(undefined, 'Zahlen oder Brüche angeben, z. B. 0 und 1');
                void commit(set(`${a.value.trim()} .. ${b.value.trim()}`));
            };
            for (const input of [a, b]) this.onCommit(input, apply);
            return el(doc, 'div', { class: 'designer-interval' }, a, el(doc, 'span', { text: '..' }), b);
        }

        // Text, number, size
        const numeric = ['Int', 'Rational'].includes(base);
        const isSize = base === 'Size' || base === 'Duration';
        const current = value?.kind === 'text' ? value.value : value?.kind === 'number' ? value.text : value?.kind === 'size' ? value.text : '';
        const multiline = !numeric && !isSize && current.length > 60;
        const input = multiline ? doc.createElement('textarea') : this.input(id, current, placeholder);
        input.id = id;
        if (multiline) {
            (input as HTMLTextAreaElement).value = current;
            (input as HTMLTextAreaElement).rows = 3;
        }
        input.placeholder = placeholder;
        this.onCommit(input, () => {
            const text = input.value;
            if (text === current) return;
            if (text.trim() === '') return void commit(unset, unset ? undefined : 'Pflichtangabe');
            if (numeric) return void commit(set(text.trim().replace(/\s+/g, '')), NUMBER.test(text.trim()) ? undefined : 'Zahl oder Bruch erwartet, z. B. 3 oder 1/20');
            if (isSize) return void commit(set(text.trim()), SIZE.test(text.trim()) ? undefined : 'Größe erwartet, z. B. 6em, 120px oder 50%');
            void commit(set(quote(text)));
        });
        return input;
    }

    private expressionField(id: string, text: string, apply: (text: string) => Promise<void>, suggestions?: Array<{ value: string; label?: string }>): HTMLElement {
        const input = this.input(id, text, suggestions?.length ? 'Ausdruck – Vorschläge mit ↓' : 'Ausdruck');
        input.classList.add('designer-expression');
        input.title = 'Ausdruck – wird wie im Text eingegeben';
        if (suggestions?.length) {
            // Native suggestions: typing filters, ↓ opens the list; screen readers announce it as a combobox
            const list = el(this.container.ownerDocument, 'datalist', { attrs: { id: `${id}-suggestions` } },
                ...suggestions.map(s => el(this.container.ownerDocument, 'option', { attrs: { value: s.value, ...(s.label ? { label: s.label } : {}) } })));
            input.setAttribute('list', list.id);
            return el(this.container.ownerDocument, 'div', { class: 'designer-suggest' }, input, list);
        }
        this.onCommit(input, () => {
            if (input.value.trim() !== text) void apply(input.value.trim());
        });
        return input;
    }

    /** List with one field per entry; text and numbers edited directly, other entries (image, formula …) as expressions. */
    private listField(id: string, param: ParamDescription, items: ListItem[], numeric: boolean, newItem: string | undefined, apply: (items: ListItem[]) => Promise<void>): HTMLElement {
        const doc = this.container.ownerDocument;
        const list = el(doc, 'div', { class: 'designer-list', attrs: { id, role: 'group', 'aria-label': param.label } });
        const values = items.map(i => ({ ...i }));
        const save = () => void apply(values.filter(v => v.value.trim() !== ''));
        values.forEach((item, index) => {
            const input = this.input(`${id}-${index}`, item.value, `${index + 1}.`);
            input.setAttribute('aria-label', `${param.label} ${index + 1}`);
            if (item.kind === 'expression') {
                input.classList.add('designer-expression');
                input.title = 'Ausdruck – wird wie im Text eingegeben';
            }
            this.onCommit(input, () => {
                if (input.value === values[index].value) return;
                values[index].value = input.value;
                save();
            });
            const up = this.button('↑', () => { if (index > 0) { [values[index - 1], values[index]] = [values[index], values[index - 1]]; save(); } });
            up.title = 'Nach oben';
            up.disabled = index === 0;
            const copy = this.button('⧉', () => { values.splice(index + 1, 0, { ...values[index] }); save(); });
            copy.title = 'Duplizieren';
            const remove = this.button('✕', () => { values.splice(index, 1); save(); });
            remove.title = 'Entfernen';
            list.append(el(doc, 'div', { class: 'designer-list-row' }, input, up, copy, remove));
        });
        const add = this.button('+ Eintrag', () => {
            values.push(newItem !== undefined ? { kind: 'expression', value: newItem } : numeric ? { kind: 'number', value: '0' } : { kind: 'text', value: 'Neu' });
            save();
        });
        add.classList.add('designer-add');
        list.append(add);
        return list;
    }

    // --- Helpers ------------------------------------------------------------------------------

    private option(text: string, value: string, defaultSelected: boolean, selected: boolean): HTMLOptionElement {
        const option = el(this.container.ownerDocument, 'option', { text, attrs: { value } });
        option.defaultSelected = defaultSelected;
        option.selected = selected;
        return option;
    }

    private input(id: string, value: string, placeholder: string): HTMLInputElement {
        const input = el(this.container.ownerDocument, 'input', { attrs: { type: 'text', id, placeholder, spellcheck: 'false' } });
        input.value = value;
        return input;
    }

    /**
     * Commits on Enter or when leaving the field: one edit, one undo step.
     * The same value is committed only once (Enter followed by the `change` on blur).
     */
    private onCommit(input: HTMLInputElement | HTMLTextAreaElement, apply: () => void): void {
        let committed = input.value;
        const commitOnce = () => {
            if (input.value === committed) return;
            committed = input.value;
            apply();
        };
        (input as HTMLElement).addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !(input instanceof HTMLTextAreaElement && e.shiftKey)) {
                e.preventDefault();
                commitOnce();
            }
        });
        input.addEventListener('change', commitOnce);
    }

    private button(text: string, onClick: () => void, variant?: string): HTMLButtonElement {
        const button = el(this.container.ownerDocument, 'button', { class: variant, text, attrs: { type: 'button' } });
        button.addEventListener('click', onClick);
        return button;
    }

    private renderEmpty(): void {
        this.container.replaceChildren(el(this.container.ownerDocument, 'p', {
            class: 'designer-muted',
            text: 'Element in der Vorschau auswählen (Klick oder Tab). Pfeiltasten: übergeordnet/untergeordnet, Entf: entfernen.'
        }));
    }
}

/** Quotes text as an AF string literal. */
export function quote(text: string): string {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
