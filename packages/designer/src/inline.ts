import type { NodeDescription } from './protocol.js';
import { el } from './dom.js';
import { boundsOf } from './overlay.js';

/** Text that can be edited in place in the preview: a text argument or a text entry of a list argument. */
export interface EditableText {
    param: string;
    /** Zero-based list index, if the text is a list entry. */
    index?: number;
    value: string;
    /** Preview element that displays the text. */
    target: HTMLElement;
}

/**
 * Finds the editable text under the pointer: an element whose content equals a text argument or text list entry of
 * the node (e.g. a question, a `Choice` option, a paragraph). Without a pointer, returns the first visible match.
 */
export function findEditableText(node: HTMLElement, description: NodeDescription, point?: { x: number; y: number }): EditableText | undefined {
    const candidates: Array<Omit<EditableText, 'target'>> = [];
    for (const p of description.params) {
        if (p.value?.kind === 'text') candidates.push({ param: p.name, value: p.value.value });
        if (p.value?.kind === 'list') p.value.items.forEach((item, index) => {
            if (item.kind === 'text') candidates.push({ param: p.name, index, value: item.value });
        });
    }
    if (candidates.length === 0) return undefined;
    const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
    const elements = [node, ...node.querySelectorAll<HTMLElement>('*')];
    const found: EditableText[] = [];
    for (const c of candidates) {
        const want = normalize(c.value);
        if (want === '') continue;
        // innermost elements whose text matches exactly
        const matches = elements.filter(e => normalize(e.textContent ?? '') === want);
        const inner = matches.filter(m => !matches.some(o => o !== m && m.contains(o)));
        for (const target of inner) found.push({ ...c, target });
    }
    const contains = (e: HTMLElement) => {
        const r = boundsOf(e);
        return !!point && !!r && point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
    };
    const hit = found.filter(f => contains(f.target));
    if (hit.length > 0) return hit.reduce((a, b) => (a.target.contains(b.target) ? b : a));
    // near miss (e.g. right of a short option): take the closest text
    if (found.length > 0 && point) return found.reduce((a, b) => (distance(b.target, point) < distance(a.target, point) ? b : a));
    if (found.length > 0) return found[0];
    // text with no visible counterpart (e.g. a screen-reader-only name): edit it on the node itself
    return point ? undefined : { ...candidates[0], target: node };
}

/** Distance from a point to an element's bounding box (0 if inside). */
function distance(e: HTMLElement, p: { x: number; y: number }): number {
    const r = boundsOf(e);
    if (!r) return Infinity;
    const dx = Math.max(r.left - p.x, 0, p.x - r.right), dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
    return Math.hypot(dx, dy);
}

/**
 * Opens a textarea over the text in the preview, using its font. Enter or blur commits (Shift+Enter inserts a
 * newline), Escape cancels. Each editing session produces at most one commit.
 */
export function openInlineEditor(layer: HTMLElement, preview: HTMLElement, text: EditableText, commit: (value: string) => void): HTMLTextAreaElement {
    const doc = layer.ownerDocument;
    layer.querySelector('.designer-inline')?.remove();
    const r = boundsOf(text.target) ?? text.target.getBoundingClientRect();
    const origin = preview.getBoundingClientRect();
    const style = doc.defaultView?.getComputedStyle(text.target);
    const area = el(doc, 'textarea', { class: 'designer-inline', attrs: { 'aria-label': `Text bearbeiten (${text.param})`, spellcheck: 'true' } });
    area.value = text.value;
    area.rows = Math.max(1, text.value.split('\n').length);
    Object.assign(area.style, {
        left: `${r.left - origin.left - 4}px`, top: `${r.top - origin.top - 3}px`,
        width: `${Math.max(r.width + 8, 120)}px`, minHeight: `${r.height + 6}px`,
        font: style?.font ?? '', fontSize: style?.fontSize ?? '', fontWeight: style?.fontWeight ?? '', lineHeight: style?.lineHeight ?? ''
    });
    let done = false;
    const finish = (apply: boolean) => {
        if (done) return;
        done = true;
        const value = area.value;
        area.remove();
        preview.focus({ preventScroll: true });
        if (apply && value !== text.value) commit(value);
    };
    area.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    area.addEventListener('blur', () => finish(true));
    layer.append(area);
    area.focus();
    area.select();
    return area;
}
