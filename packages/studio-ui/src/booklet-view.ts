import type { Bundle } from '@answerfield/bundle';
import { createBookletInstance, effect, type BookletInstance, type BookletSnapshot, type NeedsProfile } from '@answerfield/runtime-core';
import { renderItem, type Rendered } from '@answerfield/runtime-wc';

/** Options for {@link BookletView}. */
export interface BookletViewOptions {
    profile: NeedsProfile;
    restore?: BookletSnapshot;
    baseUrl?: string;
    dev?: boolean;
    /** Clock override for tests. */
    now?: () => number;
    /** Timer tick interval in milliseconds (0: no automatic ticking). */
    tickInterval?: number;
}

/**
 * Runs a booklet: a header bar with part, progress, remaining time and navigation, and the current item below.
 * Navigation follows the booklet's rules.
 */
export class BookletView {
    readonly booklet: BookletInstance;
    private readonly bar: HTMLElement;
    private readonly content: HTMLElement;
    private rendered?: Rendered;
    private readonly stops: Array<() => void> = [];
    private timer?: ReturnType<typeof setInterval>;
    private confirming = false;
    /** Remaining-time element; kept across renders so only its text changes each second (buttons are not re-created). */
    private clock?: HTMLElement;

    constructor(container: HTMLElement, bundle: Bundle, name: string, private readonly options: BookletViewOptions) {
        this.booklet = createBookletInstance(bundle, name, { profile: options.profile, restore: options.restore, now: options.now });
        const doc = container.ownerDocument;
        this.bar = doc.createElement('nav');
        this.bar.className = 'booklet-bar';
        this.bar.setAttribute('aria-label', 'Testheft');
        this.content = doc.createElement('div');
        this.content.className = 'booklet-content';
        container.append(this.bar, this.content);

        this.stops.push(effect(() => this.renderItem()));
        this.stops.push(effect(() => this.renderBar()));
        this.stops.push(effect(() => this.renderClock()));
        const interval = options.tickInterval ?? 1000;
        if (interval > 0) this.timer = setInterval(() => this.booklet.tick(), interval);
    }

    /** Stops the timer and effects and removes the view. */
    dispose(): void {
        clearInterval(this.timer);
        this.stops.splice(0).forEach(s => s());
        this.rendered?.dispose();
        this.booklet.dispose();
        this.bar.remove();
        this.content.remove();
    }

    private renderItem(): void {
        const finished = this.booklet.finished.get();
        const item = this.booklet.current.get();
        this.rendered?.dispose();
        this.rendered = undefined;
        this.content.replaceChildren();
        if (finished) {
            const p = this.content.ownerDocument.createElement('p');
            p.className = 'booklet-finished';
            p.textContent = 'Der Test ist beendet. Vielen Dank!';
            this.content.append(p);
            return;
        }
        if (this.booklet.waiting.get() || this.booklet.paused.get()) {
            const p = this.content.ownerDocument.createElement('p');
            p.className = 'booklet-finished';
            p.setAttribute('role', 'status');
            p.textContent = this.booklet.waiting.get() ? 'Bitte warte, bis es weitergeht.' : 'Pause. Es geht gleich weiter.';
            this.content.append(p);
            return;
        }
        this.rendered = renderItem(item, this.content, { dev: this.options.dev, profile: this.options.profile, baseUrl: this.options.baseUrl });
    }

    private renderBar(): void {
        const b = this.booklet;
        const doc = this.bar.ownerDocument;
        const part = b.part.get();
        const finished = b.finished.get();
        b.position.get();
        const current = b.current.get();
        const items = part.entries.filter(e => !b.items.get(e)?.item.instruction);

        const title = doc.createElement('span');
        title.className = 'booklet-part';
        title.textContent = part.title ?? part.name;

        const progress = doc.createElement('span');
        progress.className = 'booklet-progress';
        const index = items.indexOf(current.item.name);
        progress.textContent = finished ? 'beendet'
            : current.item.instruction ? 'Instruktion'
            : `Aufgabe ${index + 1} von ${items.length}` + (current.pageCount > 1 ? `, Seite ${current.page.get() + 1} von ${current.pageCount}` : '');

        if (!this.clock) {
            this.clock = doc.createElement('span');
            this.clock.className = 'booklet-timer';
            this.clock.setAttribute('role', 'timer');
            this.clock.title = `Restzeit${b.timeFactor > 1 ? ` (verlängert ×${b.timeFactor})` : ''}`;
        }
        const timer = this.clock;

        const actions = doc.createElement('span');
        actions.className = 'booklet-actions';
        const button = (label: string, onClick: () => void, disabled = false, primary = false) => {
            const el = doc.createElement('button');
            el.type = 'button';
            el.textContent = label;
            el.disabled = disabled;
            if (primary) el.classList.add('primary');
            el.addEventListener('click', onClick);
            return el;
        };
        if (!finished) {
            // Preview only: act as test administrator (in a real test these commands come from the session service)
            if (b.waiting.get()) actions.append(button('Testleitung: Teil freigeben', () => b.control({ kind: 'release' })));
            else actions.append(button(b.paused.get() ? 'Testleitung: Fortsetzen' : 'Testleitung: Pause',
                () => b.control({ kind: b.paused.get() ? 'resume' : 'pause' })));
            if (part.navigation === 'free') actions.append(button('Zurück', () => b.previous(), !b.canPrevious.get()));
            if (!b.atPartEnd.get()) {
                actions.append(button('Weiter', () => b.next(), !b.canNext.get(), true));
            } else if (this.confirming) {
                const note = doc.createElement('span');
                note.className = 'booklet-confirm';
                note.textContent = b.isLastPart.get() ? 'Test wirklich beenden?' : 'Danach geht es nicht mehr zurück.';
                actions.append(note,
                    button(b.isLastPart.get() ? 'Beenden' : 'Abschließen', () => { this.confirming = false; b.next(); }, false, true),
                    button('Abbrechen', () => { this.confirming = false; this.renderBar(); }));
            } else {
                actions.append(button(b.isLastPart.get() ? 'Test beenden' : 'Teil abschließen', () => { this.confirming = true; this.renderBar(); }, false, true));
            }
        }
        // Keep focus on the button with the same label (e.g. "Weiter" after paging)
        const focused = this.bar.contains(doc.activeElement) ? doc.activeElement?.textContent : undefined;
        this.bar.replaceChildren(title, progress, timer, actions);
        if (focused) [...actions.querySelectorAll('button')].find(x => x.textContent === focused)?.focus();
    }

    private renderClock(): void {
        const remaining = this.booklet.remaining.get();
        const timer = this.clock;
        if (!timer) return;
        timer.hidden = remaining === undefined;
        if (remaining === undefined) return;
        timer.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
        timer.classList.toggle('booklet-timer-low', remaining <= 60);
    }
}
