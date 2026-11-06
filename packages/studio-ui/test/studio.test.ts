import { beforeAll, describe, expect, test } from 'vitest';
import type { Bundle } from '@answerfield/bundle';
import { Studio, type FromStudio } from '../src/index.js';
import { workspace } from './workspace.js';

let compile: Awaited<ReturnType<typeof workspace>>['compile'];

beforeAll(async () => {
    ({ compile } = await workspace());
});

function setup() {
    document.body.innerHTML = '<div id="studio"></div>';
    const sent: FromStudio[] = [];
    const studio = new Studio(document.getElementById('studio')!, { post: m => sent.push(m) });
    const send = (bundle: Bundle, diagnostics = { errors: 0, warnings: 0, syntax: 0 }) =>
        studio.receive({ kind: 'bundle', bundle, uri: 'file:///fraction1.af', diagnostics });
    return { studio, sent, send };
}

describe('Studio', () => {
    test('zeigt Antworten und Kodierung live und meldet sie an den Host', () => {
        const { sent, send } = setup();
        expect(sent[0]).toEqual({ kind: 'ready' });
        send(compile('fraction1.af', { dev: true }).bundle);
        const radios = document.querySelectorAll('af-toggle');
        (radios[1] as HTMLElement).click();
        const side = document.querySelector('.studio-responses')!.textContent!;
        expect(side).toContain('greater');
        expect(side).toMatch(/1\s*richtig/);
        const last = sent.filter(m => m.kind === 'responses').at(-1);
        expect(last?.kind === 'responses' && last.coding.variables.greater.code).toBe(1);
    });

    test('Zustand bleibt beim Neukompilieren erhalten, Syntaxfehler behalten den letzten Stand', () => {
        const { send } = setup();
        const bundle = compile('fraction1.af', { dev: true }).bundle;
        send(bundle);
        (document.querySelectorAll('af-toggle')[2] as HTMLElement).click();
        send(structuredClone(bundle));
        expect(document.querySelectorAll('af-toggle')[2].getAttribute('aria-checked')).toBe('true');

        send({ ...bundle, items: [] }, { errors: 2, warnings: 0, syntax: 1 });
        expect(document.querySelector('af-root')).not.toBeNull();
        expect(document.querySelector('.studio-status')!.textContent).toContain('letzten gültigen Stand');
    });

    test('offene manuelle Fragen lassen sich mit Ja/Nein durchspielen', async () => {
        const { compile: compileExtra } = await workspace({ manual1: `
            item manual1 { drive = Gap("Antrieb") }
            coding manual1 { drive: correct(accept(drive, "propeller") or manual("sinngemäß: Luftschraube", yes: ["Rotor"])) }` });
        const { send } = setup();
        send(compileExtra('manual1', { dev: true }).bundle);
        const field = document.querySelector('af-input input') as HTMLInputElement;
        field.value = 'ein Rotor';
        field.dispatchEvent(new Event('input'));
        const side = () => document.querySelector('.studio-responses')!;
        expect(side().textContent).toContain('offen: manuell');
        expect(side().textContent).toContain('sinngemäß: Luftschraube');
        expect(side().textContent).toContain('richtig z. B.: Rotor');

        (side().querySelector('button[data-verdict="yes"]') as HTMLButtonElement).click();
        expect(side().textContent).toMatch(/1\s*richtig/);
        expect(side().querySelector('button[data-verdict]')).toBeNull();

        (side().querySelector('button[data-clear-judgments]') as HTMLButtonElement).click();
        expect(side().textContent).toContain('offen: manuell');
    });

    test('Alt+Klick wählt die Quelle, Cursor hebt das Element hervor', () => {
        const { studio, sent, send } = setup();
        send(compile('fraction1.af', { dev: true }).bundle);
        const p = document.querySelector('af-p')!;
        p.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
        const select = sent.find(m => m.kind === 'select');
        expect(select).toEqual({ kind: 'select', src: p.getAttribute('data-src')!.split(':').map(Number), focus: true });

        const [, start] = p.getAttribute('data-src')!.split(':').map(Number);
        studio.receive({ kind: 'reveal', offset: start + 2 });
        expect(p.classList.contains('af-studio-reveal')).toBe(true);
    });
});
