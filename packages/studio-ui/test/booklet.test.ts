import { beforeAll, describe, expect, test, vi } from 'vitest';
import type { Bundle } from '@answerfield/bundle';
import { Studio } from '../src/index.js';
import { workspace } from './workspace.js';

let bundle: Bundle;

beforeAll(async () => {
    bundle = (await workspace()).compile('booklet.af', { dev: true }).bundle;
});

const text = (selector: string) => document.querySelector(selector)?.textContent ?? '';
const click = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.booklet-actions button')].find(b => b.textContent === label)!.click();

describe('Testheft in der Vorschau', () => {
    test('Ablauf mit Instruktion, Teilabschluss, Zeitanzeige und Antworten aller Aufgaben', () => {
        document.body.innerHTML = '<div id="studio"></div>';
        const studio = new Studio(document.getElementById('studio')!, { post: () => undefined });
        studio.receive({ kind: 'bundle', bundle, uri: 'file:///booklet.af', diagnostics: { errors: 0, warnings: 0 } });

        expect([...document.querySelectorAll('.studio-tabs button')].map(b => b.textContent)).toEqual([
            'Testheft brueche – Brüche verstehen', 'fraction1 – Brüche kürzen', 'fraction2 – Anteile färben', 'fraction3 – Zahlenstrahl'
        ]);
        expect(text('.booklet-part')).toBe('Einführung');
        expect(text('.booklet-progress')).toBe('Instruktion');
        expect(text('.booklet-content')).toContain('Du bearbeitest gleich drei Aufgaben zu Brüchen.');
        expect(document.querySelector<HTMLButtonElement>('[data-mode="design"]')!.disabled).toBe(true);

        click('Teil abschließen');
        expect(text('.booklet-confirm')).toBe('Danach geht es nicht mehr zurück.');
        click('Abschließen');
        expect(text('.booklet-part')).toBe('Aufgaben');
        expect(text('.booklet-progress')).toBe('Aufgabe 1 von 3');
        expect(text('.booklet-timer')).toBe('20:00');
        expect(document.querySelector('.booklet-content af-input')).not.toBeNull();

        click('Weiter');
        expect(text('.booklet-progress')).toBe('Aufgabe 2 von 3');
        const side = text('.studio-responses');
        expect(side).toContain('fraction1.reduce');
        expect(side).toContain('fraction3.mark');
        expect(side).toMatch(/omitted/);
        expect(side).toMatch(/not_reached/);
    });

    test('Restzeit tickt, ohne die Knöpfe neu zu bauen (Fokus bleibt)', () => {
        vi.useFakeTimers();
        try {
            document.body.innerHTML = '<div id="studio"></div>';
            const studio = new Studio(document.getElementById('studio')!, { post: () => undefined });
            studio.receive({ kind: 'bundle', bundle, uri: 'file:///booklet.af', diagnostics: { errors: 0, warnings: 0 } });
            click('Teil abschließen');
            click('Abschließen');
            const next = [...document.querySelectorAll<HTMLButtonElement>('.booklet-actions button')].find(b => b.textContent === 'Weiter')!;
            const timer = document.querySelector('.booklet-timer');
            next.focus();
            vi.advanceTimersByTime(3000);
            expect(text('.booklet-timer')).toBe('19:57');
            expect(document.querySelector('.booklet-timer')).toBe(timer);
            expect([...document.querySelectorAll('.booklet-actions button')].includes(next)).toBe(true);
            expect(document.activeElement).toBe(next);
        } finally {
            vi.useRealTimers();
        }
    });
});

