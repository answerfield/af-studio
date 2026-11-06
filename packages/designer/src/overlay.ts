import type { DiagnosticInfo, DropPosition } from './protocol.js';
import { el } from './dom.js';
import { DRAG_NODE } from './palette.js';

/** Rendered element that represents a node of the main document. */
export type NodeElement = HTMLElement & { dataset: { node: string; src?: string } };

/** Callbacks of the {@link Overlay}. */
export interface OverlayCallbacks {
    /** Selection by mouse or keyboard. */
    select(element: NodeElement | undefined): void;
    /** Delete/Backspace: remove the node. */
    remove(element: NodeElement): void;
    /** Enter: jump to the properties panel. */
    activate(element: NodeElement): void;
    /** Alt+Arrow or dragging the label: move the node. */
    move?(element: NodeElement, target: NodeElement, position: DropPosition): void;
    /** Ctrl+D: duplicate. */
    duplicate?(element: NodeElement): void;
    /** F2 or double-click: edit text in place. */
    editText?(element: NodeElement, point?: { x: number; y: number }): void;
    /** After every redraw (e.g. to reposition point handles). */
    drawn?(): void;
}

/** Drop target: before, after or inside a node. */
export interface DropTarget {
    el: NodeElement;
    position: DropPosition;
}

/** Elements that accept children when dropping in the preview. `p` is excluded since `p "…"` has no body (insert via selection instead). */
const CONTAINERS = new Set(['af-root', 'af-page', 'af-section', 'af-box', 'af-list', 'af-row', 'af-group', 'af-stimulus', 'af-table',
    'af-cell', 'af-lines', 'af-show', 'af-plane', 'af-for']);

/**
 * Interaction layer over the rendered item: hover outline, selection, keyboard navigation and diagnostics.
 * The item itself is made inert (not operable) while designing.
 */
export class Overlay {
    private readonly layer: HTMLElement;
    /** Controls over the preview (text field, handles); unlike the drawing layer, exposed to screen readers. */
    private readonly tools: HTMLElement;
    /** Live region announcing the selection. */
    private readonly status: HTMLElement;
    private readonly hoverBox: HTMLElement;
    private readonly selectBox: HTMLElement;
    private readonly selectLabel: HTMLElement;
    private readonly dropLine: HTMLElement;
    private readonly dropBox: HTMLElement;
    private hovered?: NodeElement;
    private selectedId?: string;
    private diagnostics: DiagnosticInfo[] = [];
    private readonly resize: ResizeObserver;
    private readonly mutations: MutationObserver;
    private frame = 0;

    constructor(private readonly preview: HTMLElement, private readonly callbacks: OverlayCallbacks) {
        const doc = preview.ownerDocument;
        this.hoverBox = el(doc, 'div', { class: 'designer-hover', attrs: { hidden: '' } });
        // Selection label, which doubles as the drag handle for moving
        this.selectLabel = el(doc, 'span', { class: 'designer-label', attrs: { draggable: 'true', title: 'Ziehen zum Verschieben' } });
        this.selectLabel.addEventListener('dragstart', e => {
            if (!this.selectedId) return e.preventDefault();
            e.dataTransfer?.setData(DRAG_NODE, this.selectedId);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        this.selectBox = el(doc, 'div', { class: 'designer-selection', attrs: { hidden: '' } }, this.selectLabel);
        this.dropLine = el(doc, 'div', { class: 'designer-drop-line', attrs: { hidden: '' } });
        this.dropBox = el(doc, 'div', { class: 'designer-drop-box', attrs: { hidden: '' } });
        this.layer = el(doc, 'div', { class: 'designer-layer', attrs: { 'aria-hidden': 'true' } }, this.hoverBox, this.selectBox, this.dropLine, this.dropBox);
        this.status = el(doc, 'div', { class: 'designer-announce', attrs: { role: 'status', 'aria-live': 'polite' } });
        this.tools = el(doc, 'div', { class: 'designer-tools' }, this.status);
        preview.append(this.layer, this.tools);

        preview.classList.add('studio-design');
        preview.tabIndex = 0;
        preview.setAttribute('role', 'application');
        preview.setAttribute('aria-roledescription', 'Designer');
        preview.addEventListener('pointermove', this.onPointerMove);
        preview.addEventListener('pointerleave', this.onPointerLeave);
        preview.addEventListener('click', this.onClick, true);
        preview.addEventListener('keydown', this.onKeyDown);
        preview.addEventListener('dblclick', this.onDoubleClick, true);
        this.setInert(true);

        this.resize = new ResizeObserver(() => this.schedule());
        this.resize.observe(preview);
        this.mutations = new MutationObserver(records => {
            // Ignore our own drawing layer, otherwise every draw() would trigger the next
            if (records.every(r => this.layer.contains(r.target) || this.tools.contains(r.target))) return;
            this.setInert(true);
            this.schedule();
        });
        this.mutations.observe(preview, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
        preview.ownerDocument.defaultView?.addEventListener('scroll', this.schedule, true);
        this.schedule();
    }

    /** Removes listeners and layers and makes the item operable again. */
    dispose(): void {
        this.preview.removeEventListener('pointermove', this.onPointerMove);
        this.preview.removeEventListener('pointerleave', this.onPointerLeave);
        this.preview.removeEventListener('click', this.onClick, true);
        this.preview.removeEventListener('keydown', this.onKeyDown);
        this.preview.removeEventListener('dblclick', this.onDoubleClick, true);
        this.preview.ownerDocument.defaultView?.removeEventListener('scroll', this.schedule, true);
        this.resize.disconnect();
        this.mutations.disconnect();
        this.setInert(false);
        this.preview.classList.remove('studio-design');
        this.preview.removeAttribute('tabindex');
        this.preview.removeAttribute('role');
        this.preview.removeAttribute('aria-roledescription');
        this.layer.remove();
        this.tools.remove();
    }

    /** Layer for controls over the preview (text field, handles). */
    get toolLayer(): HTMLElement {
        return this.tools;
    }

    /** Currently selected node element, if still rendered. */
    get selection(): NodeElement | undefined {
        return this.selectedId ? this.find(this.selectedId) : undefined;
    }

    /** Sets the selection without notifying the host. */
    setSelection(id: string | undefined): void {
        this.selectedId = id;
        this.schedule();
    }

    /** Replaces the diagnostics shown as badges. */
    setDiagnostics(diagnostics: DiagnosticInfo[]): void {
        this.diagnostics = diagnostics;
        this.schedule();
    }

    /** Innermost node whose source range contains the offset. */
    nodeAtOffset(offset: number): NodeElement | undefined {
        let best: { el: NodeElement; length: number } | undefined;
        for (const el of this.nodes()) {
            const src = parseSrc(el);
            if (!src || src[0] !== 0 || offset < src[1] || offset > src[2]) continue;
            if (!best || src[2] - src[1] <= best.length) best = { el, length: src[2] - src[1] };
        }
        return best?.el;
    }

    /** Node starting exactly at this offset (to select after insert/move). */
    nodeStartingAt(offset: number): NodeElement | undefined {
        return this.nodes().find(el => parseSrc(el)?.[1] === offset);
    }

    /** First rendered element of a node id (loops may render several). */
    find(id: string): NodeElement | undefined {
        return this.nodes().find(el => el.dataset.node === id);
    }

    /** All selectable nodes in document order. */
    nodes(): NodeElement[] {
        return [...this.preview.querySelectorAll<NodeElement>('[data-node]')].filter(el => !el.closest('.designer-layer, .designer-tools'));
    }

    // --- Events ---------------------------------------------------------------------------

    private readonly onPointerMove = (e: PointerEvent): void => {
        const hit = this.hitTest(e.clientX, e.clientY);
        if (hit !== this.hovered) {
            this.hovered = hit;
            this.schedule();
        }
    };

    private readonly onPointerLeave = (): void => {
        this.hovered = undefined;
        this.schedule();
    };

    private readonly onClick = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        this.preview.focus({ preventScroll: true });
        this.choose(this.hitTest(e.clientX, e.clientY));
    };

    private readonly onDoubleClick = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        const hit = this.hitTest(e.clientX, e.clientY);
        if (hit) this.callbacks.editText?.(hit, { x: e.clientX, y: e.clientY });
    };

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        const target = e.target as HTMLElement;
        if (target !== this.preview) return;
        // One stop per node: loop repetitions (same id) count once, otherwise Tab would never reach the end
        const seen = new Set<string>();
        const nodes = this.nodes().filter(n => isVisible(n) && !seen.has(n.dataset.node) && seen.add(n.dataset.node) !== undefined);
        const current = this.selection;
        const index = current ? nodes.indexOf(current) : -1;
        let next: NodeElement | undefined | null = null;
        if (current && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            // Move among siblings
            e.preventDefault();
            const siblings = this.children(parentNode(current));
            const i = siblings.indexOf(current);
            const other = siblings[e.key === 'ArrowUp' ? i - 1 : i + 1];
            if (other) this.callbacks.move?.(current, other, e.key === 'ArrowUp' ? 'before' : 'after');
            return;
        }
        if (current && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            this.callbacks.duplicate?.(current);
            return;
        }
        if (current && e.key === 'F2') {
            e.preventDefault();
            this.callbacks.editText?.(current);
            return;
        }
        switch (e.key) {
            case 'Tab':
                // through the nodes; past the last (or first, with Shift+Tab) Tab leaves the preview as usual, so focus is never trapped
                if (nodes.length === 0) return;
                if (e.shiftKey ? index <= 0 : index === nodes.length - 1) return;
                next = e.shiftKey ? nodes[index - 1] : nodes[index + 1];
                break;
            case 'ArrowUp': case 'ArrowLeft':
                next = current ? parentNode(current) ?? current : nodes[0];
                break;
            case 'ArrowDown': case 'ArrowRight':
                next = current ? nodes.find(n => n !== current && current.contains(n)) ?? current : nodes[0];
                break;
            case 'Escape':
                next = undefined;
                break;
            case 'Delete': case 'Backspace':
                if (current) {
                    e.preventDefault();
                    this.callbacks.remove(current);
                }
                return;
            case 'Enter':
                if (current) {
                    e.preventDefault();
                    this.callbacks.activate(current);
                }
                return;
            default:
                return;
        }
        e.preventDefault();
        this.choose(next ?? undefined);
        this.selection?.scrollIntoView({ block: 'nearest' });
    };

    private choose(element: NodeElement | undefined): void {
        this.selectedId = element?.dataset.node;
        this.schedule();
        this.announce(element);
        this.callbacks.select(element);
    }

    /** Announces the selection for screen readers, e.g. "Choice · greater, 5 von 12". */
    private announce(element: NodeElement | undefined): void {
        const ids = [...new Set(this.nodes().filter(n => isVisible(n)).map(n => n.dataset.node))];
        this.status.textContent = element ? `${labelOf(element)}, ${ids.indexOf(element.dataset.node) + 1} von ${ids.length}` : 'Keine Auswahl';
    }

    // --- Dropping ------------------------------------------------------------------------------

    /** Direct child nodes of a node (or top-level nodes) in document order. */
    children(parent: NodeElement | undefined): NodeElement[] {
        return this.nodes().filter(n => n !== parent && parentNode(n) === parent && isVisible(n));
    }

    /**
     * Where a drop at this point would land: inside a container between its children (by pointer position,
     * horizontally for rows), otherwise before or after the node under the pointer. `moving` and its descendants
     * are never targets.
     */
    dropTarget(x: number, y: number, moving?: NodeElement): DropTarget | undefined {
        let hit: NodeElement | undefined;
        for (const n of this.nodes()) {
            if (moving && (n === moving || moving.contains(n))) continue;
            const r = boundsOf(n);
            if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
            if (!hit || hit.contains(n)) hit = n;
        }
        hit ??= this.preview.querySelector<NodeElement>('af-root[data-node]') ?? undefined;
        if (!hit) return undefined;
        if (CONTAINERS.has(hit.tagName.toLowerCase())) {
            const kids = this.children(hit).filter(k => !moving || (k !== moving && !moving.contains(k)));
            if (kids.length === 0) return { el: hit, position: 'inside' };
            const horizontal = isHorizontal(hit);
            const before = kids.find(k => {
                const r = boundsOf(k)!;
                return horizontal ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
            });
            if (before) return { el: before, position: 'before' };
            return hit.tagName === 'AF-ROOT' ? { el: kids[kids.length - 1], position: 'after' } : { el: hit, position: 'inside' };
        }
        const r = boundsOf(hit)!;
        const horizontal = isHorizontal(parentNode(hit) ?? hit);
        const first = horizontal ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
        return { el: hit, position: first ? 'before' : 'after' };
    }

    /** Shows the drop marker (line before/after a node, box around a container) or hides it. */
    showDrop(target: DropTarget | undefined): void {
        const origin = this.preview.getBoundingClientRect();
        this.dropLine.hidden = this.dropBox.hidden = true;
        if (!target) return;
        const r = boundsOf(target.el);
        if (!r) return;
        if (target.position === 'inside') {
            this.place(this.dropBox, target.el, origin);
            this.dropBox.hidden = false;
            return;
        }
        const horizontal = isHorizontal(parentNode(target.el) ?? target.el);
        const s = this.dropLine.style;
        this.dropLine.classList.toggle('vertical', horizontal);
        if (horizontal) {
            s.left = `${(target.position === 'before' ? r.left : r.right) - origin.left - 2}px`;
            s.top = `${r.top - origin.top}px`;
            s.width = '3px';
            s.height = `${r.height}px`;
        } else {
            s.left = `${r.left - origin.left}px`;
            s.top = `${(target.position === 'before' ? r.top : r.bottom) - origin.top - 2}px`;
            s.width = `${r.width}px`;
            s.height = '3px';
        }
        this.dropLine.hidden = false;
    }

    // --- Geometry ------------------------------------------------------------------------------

    /**
     * Node under the pointer. Component calls behave like groups: the first click selects the call,
     * only a click inside the selected call reaches its contents.
     */
    private hitTest(x: number, y: number): NodeElement | undefined {
        let best: NodeElement | undefined;
        for (const el of this.nodes()) {
            const r = boundsOf(el);
            // enlarge hit area of small targets (points in a plane)
            const pad = r && Math.min(r.width, r.height) < 16 ? 6 : 0;
            if (!r || x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) continue;
            if (!best || best.contains(el) || (!el.contains(best) && area(r) < area(boundsOf(best)!))) best = el;
        }
        if (!best) return undefined;
        const selected = this.selection;
        let group: NodeElement | undefined;
        for (let el: HTMLElement | null = best; el && el !== this.preview; el = el.parentElement) {
            if (el.tagName === 'AF-COMPONENT' && el.dataset.node && el !== best) {
                const entered = selected && (selected === el || el.contains(selected));
                if (!entered) group = el as NodeElement;
            }
        }
        return group ?? best;
    }

    private readonly schedule = (): void => {
        if (this.frame) return;
        const win = this.preview.ownerDocument.defaultView;
        const run = () => { this.frame = 0; this.draw(); };
        this.frame = win?.requestAnimationFrame ? win.requestAnimationFrame(run) : (setTimeout(run, 0) as unknown as number);
    };

    /** Draws outlines and badges; may be called synchronously (tests). */
    draw(): void {
        const origin = this.preview.getBoundingClientRect();
        this.place(this.hoverBox, this.hovered && this.hovered !== this.selection ? this.hovered : undefined, origin);
        const selected = this.selection;
        this.place(this.selectBox, selected, origin);
        this.selectLabel.textContent = selected ? labelOf(selected) : '';
        this.layer.querySelectorAll('.designer-badge').forEach(b => b.remove());
        for (const [node, diagnostics] of this.diagnosticsByNode()) {
            const r = boundsOf(node);
            if (!r) continue;
            const error = diagnostics.some(d => d.severity === 'error');
            const badge = el(this.preview.ownerDocument, 'span', {
                class: `designer-badge ${error ? 'error' : 'warning'}`,
                text: String(diagnostics.length),
                attrs: { title: diagnostics.map(d => d.message).join('\n') }
            });
            badge.style.left = `${r.right - origin.left - 9}px`;
            badge.style.top = `${r.top - origin.top - 9}px`;
            this.layer.append(badge);
        }
        this.callbacks.drawn?.();
    }

    /** Diagnostics grouped by the innermost node containing their position. */
    diagnosticsByNode(): Map<NodeElement, DiagnosticInfo[]> {
        const result = new Map<NodeElement, DiagnosticInfo[]>();
        for (const d of this.diagnostics) {
            const el = this.nodeAtOffset(d.start);
            if (!el) continue;
            result.set(el, [...(result.get(el) ?? []), d]);
        }
        return result;
    }

    private place(box: HTMLElement, el: NodeElement | undefined, origin: DOMRect): void {
        const r = el ? boundsOf(el) : undefined;
        box.hidden = !r;
        if (!r) return;
        box.style.left = `${r.left - origin.left - 3}px`;
        box.style.top = `${r.top - origin.top - 3}px`;
        box.style.width = `${r.width + 6}px`;
        box.style.height = `${r.height + 6}px`;
    }

    private setInert(inert: boolean): void {
        this.preview.querySelectorAll('af-root').forEach(root => {
            if ((root as HTMLElement).inert !== inert) (root as HTMLElement).inert = inert;
        });
    }
}

/** Parses `data-src` (`document:start:end`, see `Src` in @answerfield/bundle) into numbers. */
export function parseSrc(el: HTMLElement): [number, number, number] | undefined {
    const src = el.dataset.src?.split(':').map(Number);
    return src && src.length === 3 ? src as [number, number, number] : undefined;
}

function parentNode(el: NodeElement): NodeElement | undefined {
    return el.parentElement?.closest<NodeElement>('[data-node]') ?? undefined;
}

function area(r: DOMRect): number {
    return r.width * r.height;
}

/** Are children laid out side by side (row, flex row)? */
function isHorizontal(el: HTMLElement): boolean {
    if (el.tagName === 'AF-ROW') return true;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    return !!style && style.display.includes('flex') && !style.flexDirection.startsWith('column');
}

function isVisible(el: HTMLElement): boolean {
    return boundsOf(el) !== undefined;
}

/** Bounding box of a node; containers without their own box (display: contents) use their children. */
export function boundsOf(el: HTMLElement): DOMRect | undefined {
    // Plane shapes draw into an SVG spanning the whole area: measure the drawn shape, not the SVG
    const layer = el instanceof SVGSVGElement && ['AF-DOT', 'AF-POLYGON', 'AF-CAPTION'].includes(el.parentElement?.tagName ?? '');
    const own = el.getBoundingClientRect();
    if (!layer && (own.width > 0 || own.height > 0)) return own;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const child of el.children) {
        const r = layer ? (child as Element).getBoundingClientRect() : boundsOf(child as HTMLElement);
        if (!r) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    }
    if (left === Infinity) return undefined;
    return new DOMRect(left, top, right - left, bottom - top);
}

/** Short label of a node, e.g. "Choice · greater", "p", "Text". */
export function labelOf(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'af-component') return el.dataset.binding ? `${el.dataset.component} · ${el.dataset.binding}` : el.dataset.component ?? 'Komponente';
    if (tag === 'af-text') return 'Text';
    if (tag === 'af-show') return 'show';
    if (tag === 'af-for') return 'for';
    if (tag === 'af-root') return 'item';
    return tag.replace(/^af-/, '');
}
