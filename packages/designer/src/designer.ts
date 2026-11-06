import { Overlay, labelOf, parseSrc, type DropTarget, type NodeElement } from './overlay.js';
import { PropertiesPanel, quote } from './properties.js';
import type { DesignerHost, DiagnosticInfo, DropPosition, NodeDescription } from './protocol.js';
import { DRAG_ENTRY, DRAG_NODE, PalettePanel } from './palette.js';
import { findEditableText, openInlineEditor } from './inline.js';
import { PointHandles } from './handles.js';
import { DESIGNER_CSS } from './designer-css.js';
import { el } from './dom.js';

/**
 * Visual editor layered over the preview. It never mutates the tree itself: it sends edit intents to the host,
 * the source text changes, the preview rebuilds, and the selection is restored.
 */
export class Designer {
    private readonly overlay: Overlay;
    private readonly panel: PropertiesPanel;
    private readonly path: HTMLElement;
    private readonly palette: PalettePanel;
    private readonly handles: PointHandles;
    /** Description of the selected node (container? points?) */
    private description?: NodeDescription;
    private drop?: DropTarget;
    private pendingOffset?: number;
    private describeToken = 0;

    constructor(private readonly preview: HTMLElement, properties: HTMLElement, private readonly host: DesignerHost) {
        installCss(preview.ownerDocument);
        const doc = preview.ownerDocument;
        // Breadcrumb to the selection; also reaches nodes without their own box (show, for)
        this.path = el(doc, 'nav', { class: 'designer-path', attrs: { 'aria-label': 'Pfad zur Auswahl' } });
        const panelContainer = el(doc, 'div');
        this.palette = new PalettePanel(el(doc, 'section', { attrs: { 'aria-label': 'Bausteine' } }), { insert: name => void this.insert(name) });
        properties.replaceChildren(this.palette.element, this.path, panelContainer);
        void host.palette().then(entries => this.palette.setEntries(entries), () => this.palette.say('Bausteine nicht verfügbar.'));
        this.panel = new PropertiesPanel(panelContainer, {
            edit: intent => host.edit(intent),
            remove: () => { const s = this.overlay.selection; if (s) void this.remove(s); },
            showSource: () => { const src = this.overlay.selection && parseSrc(this.overlay.selection); if (src) host.showSource(src); },
            action: kind => { const s = this.overlay.selection; if (s) void host.edit({ kind, node: s.dataset.node }); }
        });
        this.overlay = new Overlay(preview, {
            select: el => this.onSelect(el, true),
            remove: el => void this.remove(el),
            activate: () => this.panel.focusFirst(),
            move: (el, target, position) => void this.moveTo(el.dataset.node, target, position),
            duplicate: el => void host.edit({ kind: 'duplicate', node: el.dataset.node }),
            editText: (el, point) => void this.editText(el, point),
            drawn: () => this.handles?.redraw()
        });
        this.handles = new PointHandles(this.overlay.toolLayer, preview, (point, x, y) => {
            const s = this.overlay.selection;
            if (s) void host.edit({ kind: 'setPoint', node: s.dataset.node, param: point.param, ...(point.index !== undefined ? { index: point.index } : {}), x, y });
        });
        // Dragging from the palette or by the selection label
        preview.addEventListener('dragover', this.onDragOver);
        preview.addEventListener('dragleave', this.onDragLeave);
        preview.addEventListener('drop', this.onDrop);
    }

    /** Inserts a building block at the selection: inside a selected container, otherwise after it; without a selection, at the end of the item. */
    async insert(name: string): Promise<void> {
        const selected = this.overlay.selection;
        const root = this.overlay.nodes().find(n => n.tagName === 'AF-ROOT');
        const target = selected ?? root;
        if (!target) return;
        const position: DropPosition = target === root || (target === selected && this.description?.container) ? 'inside' : 'after';
        await this.create(name, target, position);
    }

    /** Drops a palette entry or an existing node at a point in the preview. */
    async dropAt(data: { entry?: string; node?: string }, x: number, y: number): Promise<void> {
        const moving = data.node ? this.overlay.find(data.node) : undefined;
        const target = this.overlay.dropTarget(x, y, moving);
        this.overlay.showDrop(undefined);
        if (!target) return;
        if (data.entry) await this.create(data.entry, target.el, target.position);
        else if (data.node && target.el.dataset.node !== data.node) await this.moveTo(data.node, target.el, target.position);
    }

    private async create(name: string, target: NodeElement, position: DropPosition): Promise<void> {
        const result = await this.host.edit({ kind: 'create', callable: name, target: target.dataset.node, position });
        this.palette.say(result.ok ? `${name} eingefügt.` : result.error ?? 'Einfügen nicht möglich.');
    }

    private async moveTo(node: string, target: NodeElement, position: DropPosition): Promise<void> {
        const result = await this.host.edit({ kind: 'moveTo', node, target: target.dataset.node, position });
        if (!result.ok) this.palette.say(result.error ?? 'Verschieben nicht möglich.');
    }

    /** Edits text in place (double-click, F2); falls back to the properties panel if no text matches. */
    private async editText(node: NodeElement, point?: { x: number; y: number }): Promise<void> {
        if (this.overlay.selection !== node) {
            this.overlay.setSelection(node.dataset.node);
            this.onSelect(node, true);
        }
        const description = await this.host.describe(node.dataset.node);
        const text = description && findEditableText(node, description, point);
        if (!text) return this.panel.focusFirst();
        openInlineEditor(this.overlay.toolLayer, this.preview, text, value => {
            void this.host.edit(text.index !== undefined
                ? { kind: 'setListItem', node: node.dataset.node, param: text.param, index: text.index, value: quote(value) }
                : { kind: 'setArgument', node: node.dataset.node, param: text.param, value: quote(value) });
        });
    }

    private readonly onDragOver = (e: DragEvent): void => {
        const types = [...(e.dataTransfer?.types ?? [])];
        if (!types.includes(DRAG_ENTRY) && !types.includes(DRAG_NODE)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = types.includes(DRAG_NODE) ? 'move' : 'copy';
        // Drag data is unreadable during dragover; a moved node is always the selection
        this.drop = this.overlay.dropTarget(e.clientX, e.clientY, types.includes(DRAG_NODE) ? this.overlay.selection : undefined);
        this.overlay.showDrop(this.drop);
    };

    private readonly onDragLeave = (e: DragEvent): void => {
        if (!this.preview.contains(e.relatedTarget as Node | null)) this.overlay.showDrop(undefined);
    };

    private readonly onDrop = (e: DragEvent): void => {
        const entry = e.dataTransfer?.getData(DRAG_ENTRY), node = e.dataTransfer?.getData(DRAG_NODE);
        if (!entry && !node) return;
        e.preventDefault();
        void this.dropAt({ ...(entry ? { entry } : {}), ...(node ? { node } : {}) }, e.clientX, e.clientY);
    };

    /** Call after every preview rebuild: updates diagnostics and restores the selection. */
    refresh(diagnostics: DiagnosticInfo[]): void {
        this.overlay.setDiagnostics(diagnostics);
        if (this.pendingOffset !== undefined) {
            const el = this.overlay.nodeStartingAt(this.pendingOffset);
            this.pendingOffset = undefined;
            if (el) {
                this.overlay.setSelection(el.dataset.node);
                this.onSelect(el, true);
                return;
            }
        }
        const selected = this.overlay.selection;
        if (selected) this.onSelect(selected, false);
        else {
            this.handles.clear();
            this.panel.show(undefined);
        }
    }

    /** Selects the node at a text cursor offset (without notifying the host back). */
    selectFromText(offset: number): void {
        const el = this.overlay.nodeAtOffset(offset);
        if (!el || el.dataset.node === this.overlay.selection?.dataset.node) return;
        this.overlay.setSelection(el.dataset.node);
        this.onSelect(el, false);
    }

    /** After a successful edit: select the node starting at this offset once the preview has rebuilt. */
    selectAfterRebuild(offset: number | undefined): void {
        this.pendingOffset = offset;
    }

    /** Removes listeners and overlay elements. */
    dispose(): void {
        this.preview.removeEventListener('dragover', this.onDragOver);
        this.preview.removeEventListener('dragleave', this.onDragLeave);
        this.preview.removeEventListener('drop', this.onDrop);
        this.handles.clear();
        this.overlay.dispose();
        this.panel.show(undefined);
        this.path.replaceChildren();
    }

    /** Renders the breadcrumb from the item to the selection; each segment selects its node. */
    private renderPath(selected: NodeElement | undefined): void {
        const doc = this.path.ownerDocument;
        const chain: NodeElement[] = [];
        for (let n: HTMLElement | null = selected ?? null; n; n = n.parentElement?.closest<HTMLElement>('[data-node]') ?? null) {
            chain.unshift(n as NodeElement);
        }
        const parts = chain.map((node, i) => {
            const button = el(doc, 'button', { text: labelOf(node), attrs: { type: 'button', 'aria-current': i === chain.length - 1 ? 'true' : undefined } });
            button.addEventListener('click', () => {
                this.overlay.setSelection(node.dataset.node);
                this.onSelect(node, true);
            });
            return button;
        });
        const separated = parts.flatMap((p, i) => i === 0 ? [p] : [el(doc, 'span', { class: 'designer-path-sep', text: '›', attrs: { 'aria-hidden': 'true' } }), p]);
        this.path.replaceChildren(...separated);
        this.path.hidden = parts.length === 0;
    }

    private onSelect(el: NodeElement | undefined, notify: boolean): void {
        if (notify) this.host.selected(el ? { id: el.dataset.node, src: parseSrc(el) } : undefined);
        this.renderPath(el);
        const token = ++this.describeToken;
        if (!el) {
            this.description = undefined;
            this.handles.clear();
            this.panel.show(undefined);
            return;
        }
        const own = this.overlay.diagnosticsByNode().get(el) ?? [];
        void this.host.describe(el.dataset.node).then(description => {
            if (token !== this.describeToken) return;
            this.description = description;
            this.panel.show(description, own);
            this.handles.show(el, description?.points);
        });
    }

    private async remove(el: NodeElement): Promise<void> {
        const result = await this.host.edit({ kind: 'delete', node: el.dataset.node });
        if (result.ok) {
            this.overlay.setSelection(undefined);
            this.panel.show(undefined);
        }
    }
}

function installCss(doc: Document): void {
    if (doc.getElementById('af-designer-css')) return;
    doc.head.append(el(doc, 'style', { text: DESIGNER_CSS, attrs: { id: 'af-designer-css' } }));
}
