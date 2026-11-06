import { afterEach, beforeAll, expect, test } from 'vitest';
import { Overlay } from '@answerfield/designer';

beforeAll(() => {
    // happy-dom computes no layout: give every element a visible box
    HTMLElement.prototype.getBoundingClientRect = function () { return new DOMRect(10, 10, 200, 30); };
});

afterEach(() => document.body.replaceChildren());

test('Overlay zeichnet nach einer Änderung einmal, nicht in jedem Frame erneut', async () => {
    const preview = document.createElement('div');
    const node = document.createElement('af-p');
    node.dataset.node = 'n1';
    node.dataset.src = '0:0:10';
    preview.append(node);
    document.body.append(preview);

    const overlay = new Overlay(preview, { select() { }, remove() { }, activate() { } });
    let draws = 0;
    const draw = overlay.draw.bind(overlay);
    overlay.draw = () => { draws++; draw(); };

    // selection outline and diagnostic badge only touch the overlay's own layer
    overlay.setSelection('n1');
    overlay.setDiagnostics([{ severity: 'error', message: 'Fehler', start: 2, end: 3 }]);
    await new Promise(r => setTimeout(r, 200));
    expect(draws).toBeLessThanOrEqual(2);
    expect(preview.querySelectorAll('.designer-badge')).toHaveLength(1);

    // changes to the item itself still trigger a redraw
    draws = 0;
    node.hidden = true;
    await new Promise(r => setTimeout(r, 50));
    expect(draws).toBeGreaterThanOrEqual(1);
    overlay.dispose();
});
