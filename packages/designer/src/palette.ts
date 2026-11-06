import type { PaletteEntry } from './protocol.js';
import { el } from './dom.js';

/** Drag data type for a palette entry. */
export const DRAG_ENTRY = 'application/x-af-palette';
/** Drag data type for moving an existing node. */
export const DRAG_NODE = 'application/x-af-node';

/** Callbacks of the {@link PalettePanel}. */
export interface PaletteCallbacks {
    /** Click or Enter: insert at the selection. */
    insert(name: string): void;
}

/**
 * Searchable list of building blocks, grouped as in the language reference (item types, text and layout, plane …).
 * A block is inserted at the selection by click/Enter, or dragged into the preview.
 */
export class PalettePanel {
    private entries: PaletteEntry[] = [];
    private readonly search: HTMLInputElement;
    private readonly list: HTMLElement;
    private readonly status: HTMLElement;

    constructor(readonly element: HTMLElement, private readonly callbacks: PaletteCallbacks) {
        const doc = element.ownerDocument;
        element.classList.add('designer-palette');
        this.search = el(doc, 'input', { attrs: { type: 'search', placeholder: 'Baustein suchen …', 'aria-label': 'Baustein suchen', spellcheck: 'false' } });
        this.search.addEventListener('input', () => this.render());
        this.search.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const first = this.list.querySelector<HTMLButtonElement>('button[data-entry]');
                if (first) { e.preventDefault(); this.callbacks.insert(first.dataset.entry!); }
            }
        });
        this.list = el(doc, 'div', { class: 'designer-palette-groups' });
        this.status = el(doc, 'p', { class: 'designer-palette-status', attrs: { role: 'status' } });
        element.replaceChildren(
            el(doc, 'h3', { text: 'Bausteine' }),
            el(doc, 'p', { class: 'designer-muted', text: 'Klicken fügt an der Auswahl ein; oder in die Vorschau ziehen.' }),
            this.search, this.list, this.status);
    }

    /** Replaces the entries and re-renders. */
    setEntries(entries: PaletteEntry[]): void {
        this.entries = entries;
        this.render();
    }

    /** Status message after inserting (e.g. a language error); announced via `role=status`. */
    say(text: string): void {
        this.status.textContent = text;
    }

    private render(): void {
        const doc = this.element.ownerDocument;
        const query = this.search.value.trim().toLowerCase();
        const shown = this.entries.filter(e => !query || e.name.toLowerCase().includes(query) || (e.doc ?? '').toLowerCase().includes(query));
        const groups = [...new Set(shown.map(e => e.group))];
        this.list.replaceChildren(...groups.map(group => {
            const details = el(doc, 'details', { class: 'designer-palette-group' }, el(doc, 'summary', { text: group }));
            details.open = query !== '' || group === 'Aufgabentypen' || group === 'Text und Aufbau';
            const items = el(doc, 'div', { class: 'designer-palette-items' });
            for (const entry of shown.filter(e => e.group === group)) {
                const button = el(doc, 'button', {
                    class: 'designer-palette-entry', text: entry.name,
                    attrs: { type: 'button', draggable: 'true', 'data-entry': entry.name, title: entry.doc ?? entry.name }
                });
                button.addEventListener('click', () => this.callbacks.insert(entry.name));
                button.addEventListener('dragstart', e => {
                    e.dataTransfer?.setData(DRAG_ENTRY, entry.name);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                });
                items.append(button);
            }
            details.append(items);
            return details;
        }));
        if (shown.length === 0) this.list.append(el(doc, 'p', { class: 'designer-muted', text: 'Kein Baustein passt.' }));
    }
}
