/** Options for {@link el}. */
export interface ElementInit {
    class?: string;
    text?: string;
    /** Attributes; `undefined` values are skipped. */
    attrs?: Record<string, string | undefined>;
}

/** Creates an element in `doc` with class, text, attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
    doc: Document, tag: K, init: ElementInit = {}, ...children: Node[]
): HTMLElementTagNameMap[K] {
    const element = doc.createElement(tag);
    if (init.class) element.className = init.class;
    if (init.text !== undefined) element.textContent = init.text;
    for (const [name, value] of Object.entries(init.attrs ?? {})) {
        if (value !== undefined) element.setAttribute(name, value);
    }
    element.append(...children);
    return element;
}
