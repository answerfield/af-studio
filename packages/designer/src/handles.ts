import { coordsAt, percentAt, type AfPlane } from '@answerfield/runtime-wc';
import type { PointHandle } from './protocol.js';
import { el } from './dom.js';

type PlaneElement = AfPlane;

/**
 * Handles for the points of the selected node in a plane (`dot(at: …)`, polygon corners, segment ends).
 * Dragging snaps to the grid (quarters without a grid); arrow keys move by one step. Exactly one text edit is
 * produced on release or after a short pause in key presses.
 */
export class PointHandles {
    private plane?: PlaneElement;
    private handles: Array<{ point: PointHandle; button: HTMLButtonElement; x: number; y: number }> = [];
    private timer?: ReturnType<typeof setTimeout>;

    constructor(
        private readonly tools: HTMLElement,
        private readonly preview: HTMLElement,
        private readonly commit: (point: PointHandle, x: string, y: string) => void
    ) { }

    /** Shows handles for a node; none if it has no points or is not inside a plane. */
    show(node: HTMLElement | undefined, points: PointHandle[] | undefined): void {
        // After a rebuild (e.g. following an arrow-key edit) the same handle keeps focus
        const doc = this.tools.ownerDocument;
        const had = this.handles.find(h => h.button === doc.activeElement)?.point;
        this.clear();
        const plane = node?.closest<PlaneElement>('af-plane') ?? undefined;
        if (!node || !plane?.frame || !points?.length) return;
        this.plane = plane;
        for (const point of points) {
            const name = point.label ?? (point.index !== undefined ? `Punkt ${point.index + 1}` : point.param);
            const button = el(doc, 'button', { class: 'designer-handle', attrs: { type: 'button' } });
            const handle = { point, button, x: point.x, y: point.y };
            const describe = () => {
                button.setAttribute('aria-label', `${name} bei (${fmt(handle.x)} | ${fmt(handle.y)}) – ziehen oder Pfeiltasten`);
                button.dataset.coords = `${name} (${fmt(handle.x)} | ${fmt(handle.y)})`;
            };
            describe();
            button.addEventListener('pointerdown', e => {
                e.preventDefault();
                e.stopPropagation();
                try { button.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
                button.dataset.dragging = '';
                button.focus();
            });
            button.addEventListener('pointermove', e => {
                if (!('dragging' in button.dataset)) return;
                const at = this.coordsAt(e.clientX, e.clientY);
                if (!at) return;
                [handle.x, handle.y] = at;
                describe();
                this.position(handle);
            });
            const release = () => {
                if (!('dragging' in button.dataset)) return;
                delete button.dataset.dragging;
                this.apply(handle);
            };
            button.addEventListener('pointerup', release);
            button.addEventListener('pointercancel', release);
            button.addEventListener('click', e => e.stopPropagation());
            button.addEventListener('keydown', e => {
                const keys: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
                const d = keys[e.key];
                if (e.key === 'Enter') { e.preventDefault(); this.apply(handle); return; }
                if (!d) return;
                e.preventDefault();
                e.stopPropagation();
                const step = this.step();
                const f = this.plane!.frame!;
                handle.x = clamp(handle.x + d[0] * step, f.x0, f.x1);
                handle.y = clamp(handle.y + d[1] * step, f.y0, f.y1);
                describe();
                this.position(handle);
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.apply(handle), 600);
            });
            this.handles.push(handle);
            this.tools.append(button);
        }
        this.redraw();
        if (had) this.handles.find(h => h.point.param === had.param && h.point.index === had.index)?.button.focus();
    }

    /** Repositions handles after a resize or rebuild. */
    redraw(): void {
        // Plane was just rebuilt: keep handles (and focus) until `show` places them on the new plane
        if (this.plane && !this.plane.isConnected) return;
        this.handles.forEach(h => this.position(h));
    }

    /** Removes all handles. */
    clear(): void {
        clearTimeout(this.timer);
        this.handles.forEach(h => h.button.remove());
        this.handles = [];
        this.plane = undefined;
    }

    private apply(handle: { point: PointHandle; x: number; y: number }): void {
        clearTimeout(this.timer);
        if (handle.x === handle.point.x && handle.y === handle.point.y) return;
        this.commit(handle.point, fmt(handle.x), fmt(handle.y));
    }

    private area(): HTMLElement | undefined {
        return this.plane?.querySelector<HTMLElement>(':scope > .af-plane-area') ?? undefined;
    }

    private step(): number {
        const grid = this.plane?.gridStep?.toNumber();
        return grid && grid > 0 ? grid : 0.25;
    }

    /** Plane coordinates under the pointer, snapped and clamped to the frame. */
    private coordsAt(clientX: number, clientY: number): [number, number] | undefined {
        const area = this.area(), f = this.plane?.frame;
        if (!area || !f) return undefined;
        const r = area.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return undefined;
        const step = this.step();
        const snap = (v: number, lo: number, hi: number) => clamp(Math.round(v / step) * step, lo, hi);
        const { x, y } = coordsAt(f, r, clientX, clientY);
        return [snap(x, f.x0, f.x1), snap(y, f.y0, f.y1)];
    }

    private position(handle: { button: HTMLButtonElement; x: number; y: number }): void {
        const area = this.area(), f = this.plane?.frame;
        if (!area || !f) return;
        const r = area.getBoundingClientRect(), origin = this.preview.getBoundingClientRect();
        const { left, top } = percentAt(f, handle.x, handle.y);
        handle.button.style.left = `${r.left - origin.left + (left / 100) * r.width}px`;
        handle.button.style.top = `${r.top - origin.top + (top / 100) * r.height}px`;
    }
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

/** Formats a number for source text: at most four decimals, never "-0". */
export function fmt(v: number): string {
    const r = Math.round(v * 10000) / 10000;
    return String(Object.is(r, -0) ? 0 : r);
}
