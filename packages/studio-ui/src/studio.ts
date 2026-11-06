import type { Bundle, CodingResult, Judgments, ResponseSet, Src, StateSnapshot, VariableCode } from '@answerfield/bundle';
import {
    ACCOMMODATION_NAMES, adaptationReport, codeResponses, createItemInstance, effect, requestedAccommodations, signal,
    type AdaptationReport, type ItemInstance, type NeedsProfile
} from '@answerfield/runtime-core';
import { attachPractice, type Practice } from '@answerfield/practice';
import { renderItem, type Rendered } from '@answerfield/runtime-wc';
import { Designer, type DiagnosticInfo, type EditIntent, type NodeDescription, type PaletteEntry } from '@answerfield/designer';
import type { EditReply, FromStudio, StudioHost, ToStudio } from './protocol.js';
import { STUDIO_CSS } from './studio-css.js';
import { BookletView } from './booklet-view.js';
import type { BookletSnapshot } from '@answerfield/runtime-core';

/** `preview` runs the item; `design` adds the visual designer. */
export type StudioMode = 'preview' | 'design';

interface PersistedState {
    item?: string;
    mode?: StudioMode;
    profile: NeedsProfile;
    snapshots: Record<string, StateSnapshot>;
    booklets?: Record<string, BookletSnapshot>;
    /** Simulated manual-coding judgments per item. */
    judgments?: Record<string, Judgments>;
}

const BOOKLET = 'booklet:';

/** Response value formatted for human coders. */
function answerText(value: unknown): string {
    if (value === null || value === undefined || value === '') return '–';
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Item preview using the same runtime as in live testing: operate the item, watch responses and coding update
 * live, and switch the needs profile. In design mode the visual designer is layered on top.
 */
export class Studio {
    private bundle?: Bundle;
    private uri?: string;
    private baseUrl?: string;
    private instance?: ItemInstance;
    private rendered?: Rendered;
    private practice?: Practice;
    private stopEffects: Array<() => void> = [];
    private state: PersistedState;
    private version?: number;
    private diagnostics: DiagnosticInfo[] = [];
    private designer?: Designer;
    private bookletView?: BookletView;
    private requestId = 0;
    private readonly pending = new Map<number, (result: unknown) => void>();
    /** Bumped on every judgment so the coding is recomputed. */
    private readonly judged = signal(0);

    private readonly el: {
        tabs: HTMLElement; modes: HTMLElement; profile: HTMLElement; pages: HTMLElement; status: HTMLElement;
        preview: HTMLElement; responses: HTMLElement; title: HTMLElement; properties: HTMLElement; main: HTMLElement;
        adaptation: HTMLElement;
    };

    constructor(container: HTMLElement, private readonly host: StudioHost) {
        const saved = host.getState?.() as PersistedState | undefined;
        this.state = saved && typeof saved === 'object' && 'snapshots' in saved ? saved : { profile: {}, snapshots: {} };

        const doc = container.ownerDocument;
        if (!doc.getElementById('af-studio-css')) {
            const style = doc.createElement('style');
            style.id = 'af-studio-css';
            style.textContent = STUDIO_CSS;
            doc.head.appendChild(style);
        }
        container.classList.add('af-studio');
        container.innerHTML = `
          <header class="studio-toolbar">
            <div class="studio-modes" role="group" aria-label="Modus">
              <button type="button" data-mode="preview">Vorschau</button>
              <button type="button" data-mode="design">Design</button>
            </div>
            <nav class="studio-tabs" aria-label="Aufgaben"></nav>
            <div class="studio-profile" role="group" aria-label="Bedarfsprofil"></div>
            <div class="studio-pages"></div>
            <button type="button" class="studio-skip" title="Nur Vorschau: Lesezeit, Wiedergabe oder Pause sofort beenden" hidden>Phase überspringen</button>
            <button type="button" class="studio-reset" title="Antworten und Zustand zurücksetzen">Zurücksetzen</button>
          </header>
          <div class="studio-status" role="status" hidden></div>
          <main class="studio-main">
            <div class="studio-scroll">
              <section class="studio-preview" aria-label="Vorschau">
                <p class="studio-empty">Warte auf Aufgabe …</p>
              </section>
              <aside class="studio-side" aria-labelledby="studio-side-title">
                <h2 id="studio-side-title">Antworten und Kodierung</h2>
                <div class="studio-responses"></div>
                <section class="studio-adaptation" aria-labelledby="studio-adaptation-title" hidden>
                  <h2 id="studio-adaptation-title">Fassungen</h2>
                  <div class="studio-adaptation-body"></div>
                </section>
              </aside>
            </div>
            <aside class="studio-properties" aria-label="Eigenschaften" hidden></aside>
          </main>`;
        const q = (s: string) => container.querySelector(s) as HTMLElement;
        this.el = {
            tabs: q('.studio-tabs'), modes: q('.studio-modes'), profile: q('.studio-profile'), pages: q('.studio-pages'),
            status: q('.studio-status'), preview: q('.studio-preview'), responses: q('.studio-responses'),
            title: q('#studio-side-title'), properties: q('.studio-properties'), main: q('.studio-main'),
            adaptation: q('.studio-adaptation')
        };
        q('.studio-reset').addEventListener('click', () => this.reset());
        q('.studio-skip').addEventListener('click', () => this.skipPhase());
        this.el.modes.querySelectorAll<HTMLButtonElement>('button').forEach(b =>
            b.addEventListener('click', () => this.setMode(b.dataset.mode as StudioMode)));
        this.applyMode();
        this.el.preview.addEventListener('click', e => this.onPreviewClick(e), true);
        this.el.responses.addEventListener('click', e => this.onJudge(e));
        this.renderProfileControls();
        host.post({ kind: 'ready' });
    }

    /** Current mode (persisted in host state). */
    get mode(): StudioMode {
        return this.state.mode ?? 'preview';
    }

    /** Switches between preview and design mode. */
    setMode(mode: StudioMode): void {
        if (mode === this.mode) return;
        this.state.mode = mode;
        this.host.setState?.(this.state);
        this.applyMode();
    }

    /** Handles a message from the host. */
    receive(message: ToStudio): void {
        switch (message.kind) {
            case 'reply': {
                const resolve = this.pending.get(message.requestId);
                this.pending.delete(message.requestId);
                resolve?.(message.result);
                break;
            }
            case 'bundle': {
                const sameDocument = this.uri === message.uri;
                if (sameDocument && this.bundle && (message.diagnostics.syntax ?? 0) > 0) {
                    // While typing: keep the last valid render instead of replacing it with errors
                    this.showStatus(message.diagnostics, true);
                    return;
                }
                this.saveSnapshot();
                this.bundle = message.bundle;
                this.uri = message.uri;
                this.baseUrl = message.baseUrl;
                this.version = message.version;
                this.diagnostics = message.diagnostics.list ?? [];
                if (!sameDocument && this.state.item && !this.tabs.some(t => t.key === this.state.item)) {
                    this.state.item = undefined;
                }
                this.showStatus(message.diagnostics);
                this.renderTabs();
                this.mount();
                break;
            }
            case 'reveal':
                if (this.designer) this.designer.selectFromText(message.offset);
                else this.reveal(message.offset);
                break;
        }
    }

    // --- Mounting items ---------------------------------------------------------------

    /** Tabs for booklets and items (instruction pages only appear inside booklets). */
    private get tabs(): Array<{ key: string; label: string }> {
        const bundle = this.bundle;
        if (!bundle) return [];
        return [
            ...(bundle.booklets ?? []).map(b => ({ key: BOOKLET + b.name, label: `Testheft ${b.name}${b.title ? ' – ' + b.title : ''}` })),
            ...bundle.items.filter(i => !i.instruction).map(i => ({ key: i.name, label: i.title ? `${i.name} – ${i.title}` : i.name }))
        ];
    }

    private get currentTab(): string | undefined {
        const tabs = this.tabs;
        return tabs.find(t => t.key === this.state.item)?.key ?? tabs[0]?.key;
    }

    private get currentItem(): string | undefined {
        const tab = this.currentTab;
        return tab && !tab.startsWith(BOOKLET) ? tab : undefined;
    }

    private get currentBooklet(): string | undefined {
        const tab = this.currentTab;
        return tab?.startsWith(BOOKLET) ? tab.slice(BOOKLET.length) : undefined;
    }

    private mount(): void {
        this.unmount();
        this.applyMode();
        const bundle = this.bundle, name = this.currentItem, booklet = this.currentBooklet;
        if (bundle && booklet) {
            this.mountBooklet(bundle, booklet);
            return;
        }
        if (!bundle || !name) {
            this.clearPreview();
            this.el.preview.prepend(this.emptyState());
            this.el.responses.replaceChildren();
            this.el.pages.replaceChildren();
            return;
        }
        this.clearPreview();
        const profile = this.state.profile;
        try {
            this.instance = createItemInstance(bundle, name, {
                restore: this.state.snapshots[name],
                accommodations: requestedAccommodations(profile)
            });
            this.rendered = renderItem(this.instance, this.el.preview, { dev: true, profile, baseUrl: this.baseUrl });
        } catch (e) {
            // Saved state incompatible after an edit: start fresh without restoring
            delete this.state.snapshots[name];
            this.instance = createItemInstance(bundle, name, { accommodations: requestedAccommodations(profile) });
            this.rendered = renderItem(this.instance, this.el.preview, { dev: true, profile, baseUrl: this.baseUrl });
            console.warn('Zustand verworfen:', e);
        }
        const instance = this.instance;
        this.practice = attachPractice(this.rendered.root, instance);
        this.stopEffects.push(effect(() => {
            const responses = instance.responses();
            const coding = codeResponses(bundle, responses, this.judgmentsOf(responses.item));
            this.renderResponses([{ responses, coding }], new Set(responses.accommodations));
            this.host.post({ kind: 'responses', responses, coding });
            this.saveSnapshot();
        }));
        this.stopEffects.push(effect(() => this.renderPages(instance)));
        this.renderAdaptation(bundle, name);
        this.showSkip(instance.clock !== undefined);
        this.designer?.refresh(this.diagnostics);
    }

    /** Empty document: start an item or a component (named after the file) with one click. */
    private emptyState(): HTMLElement {
        const doc = this.el.preview.ownerDocument;
        const box = doc.createElement('div');
        box.className = 'studio-empty';
        const text = doc.createElement('p');
        text.textContent = 'Dieses Dokument enthält keine Aufgabe.';
        box.append(text);
        if (this.version === undefined) return box;
        for (const [what, label] of [['item', 'Aufgabe anlegen'], ['component', 'Komponente anlegen']] as const) {
            const button = doc.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', async () => {
                const result = await this.edit({ kind: 'scaffold', what });
                if (!result.ok) text.textContent = result.error ?? 'Anlegen nicht möglich.';
                else this.setMode('design');
            });
            box.append(button, ' ');
        }
        return box;
    }

    /** What the item rules out and which texts and graphics still lack a language level or description. */
    private renderAdaptation(bundle: Bundle, name: string): void {
        let report: AdaptationReport;
        try {
            report = adaptationReport(bundle, name);
        } catch {
            this.el.adaptation.hidden = true;
            return;
        }
        const levels = { simple: 'Einfache Sprache', easy: 'Leichte Sprache' };
        const rows: string[] = [];
        if (report.denied.length > 0) {
            rows.push(`<p><strong>Ausgeschlossen:</strong> ${esc(report.denied.map(a => ACCOMMODATION_NAMES[a] ?? a).join(', '))}${report.reason ? ` <span class="muted">– ${esc(report.reason)}</span>` : ''}</p>`);
        }
        for (const level of report.levels.filter(l => l.total > 0)) {
            const open = level.unchanged.length > 0
                ? `<details><summary>${level.unchanged.length} unverändert</summary><ul>${level.unchanged.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : '';
            rows.push(`<p><strong>${levels[level.level]}:</strong> ${level.adapted} von ${level.total} Texten angepasst</p>${open}`);
        }
        if (report.graphics && report.graphics.total > 0) {
            rows.push(`<p><strong>Bildbeschreibungen:</strong> ${report.graphics.described} von ${report.graphics.total} Grafiken</p>`);
        }
        if (report.varies) rows.push('<p class="muted">Die Zahlen hängen von Anpassungen ab: Diese Fassungen sind leichter oder schwerer, nicht nur anders dargestellt.</p>');
        this.el.adaptation.querySelector('.studio-adaptation-body')!.innerHTML = rows.join('');
        this.el.adaptation.hidden = rows.length === 0;
    }

    private mountBooklet(bundle: Bundle, name: string): void {
        this.el.adaptation.hidden = true;
        this.clearPreview();
        this.el.pages.replaceChildren();
        const options = { profile: this.state.profile, baseUrl: this.baseUrl, dev: true };
        try {
            this.bookletView = new BookletView(this.el.preview, bundle, name, { ...options, restore: this.state.booklets?.[name] });
        } catch (e) {
            delete this.state.booklets?.[name];
            this.bookletView = new BookletView(this.el.preview, bundle, name, options);
            console.warn('Zustand verworfen:', e);
        }
        const booklet = this.bookletView.booklet;
        this.stopEffects.push(effect(() => this.showSkip(booklet.current.get().clock !== undefined && !booklet.finished.get())));
        this.stopEffects.push(effect(() => {
            const responses = booklet.responses();
            const coding = responses.map(r => codeResponses(bundle, r, this.judgmentsOf(r.item)));
            this.renderResponses(responses.map((r, i) => ({ responses: r, coding: coding[i] })), booklet.accommodations);
            this.saveSnapshot();
        }));
    }

    private clearPreview(): void {
        [...this.el.preview.children].filter(c => !c.classList.contains('designer-layer') && !c.classList.contains('designer-tools')).forEach(c => c.remove());
    }

    // --- Designer ------------------------------------------------------------------------------

    private applyMode(): void {
        // Booklets are edited as text; the designer works on items only
        const design = this.mode === 'design' && !this.currentBooklet;
        this.el.modes.querySelector<HTMLButtonElement>('[data-mode="design"]')!.disabled = !!this.currentBooklet;
        this.el.modes.querySelector<HTMLButtonElement>('[data-mode="design"]')!.title = this.currentBooklet ? 'Testhefte im Text bearbeiten; Aufgaben über ihren Reiter' : '';
        this.el.modes.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === (design ? 'design' : 'preview'))));
        this.el.main.classList.toggle('studio-main-design', design);
        this.el.properties.hidden = !design;
        if (design && !this.designer) {
            this.designer = new Designer(this.el.preview, this.el.properties, {
                describe: node => this.request<NodeDescription | null>({ kind: 'describe', requestId: 0, node }).then(d => d ?? undefined),
                palette: () => this.request<PaletteEntry[] | null>({ kind: 'palette', requestId: 0 }).then(p => p ?? []),
                edit: intent => this.edit(intent),
                selected: node => { if (node?.src) this.host.post({ kind: 'select', src: node.src, focus: false }); },
                showSource: src => this.host.post({ kind: 'select', src, focus: true })
            });
            this.designer.refresh(this.diagnostics);
        } else if (!design && this.designer) {
            this.designer.dispose();
            this.designer = undefined;
        }
    }

    private async edit(intent: EditIntent): Promise<{ ok: boolean; error?: string }> {
        if (this.version === undefined) return { ok: false, error: 'Bearbeiten ist hier nicht verfügbar.' };
        const reply = await this.request<EditReply>({ kind: 'edit', requestId: 0, version: this.version, intent });
        if (reply?.ok) this.designer?.selectAfterRebuild(reply.select);
        return reply ?? { ok: false, error: 'Keine Antwort vom Editor.' };
    }

    /** Sends a request to the host; the answer arrives as `reply` with the same requestId. */
    private request<T>(message: Extract<FromStudio, { requestId: number }>): Promise<T | undefined> {
        const requestId = ++this.requestId;
        return new Promise(resolve => {
            this.pending.set(requestId, result => resolve(result as T));
            this.host.post({ ...message, requestId });
        });
    }

    private unmount(): void {
        this.stopEffects.splice(0).forEach(s => s());
        this.bookletView?.dispose();
        this.bookletView = undefined;
        this.practice?.dispose();
        this.practice = undefined;
        this.rendered?.dispose();
        this.instance?.dispose();
        this.rendered = undefined;
        this.instance = undefined;
    }

    private saveSnapshot(): void {
        if (this.instance) this.state.snapshots[this.instance.item.name] = this.instance.snapshot();
        if (this.bookletView) {
            this.state.booklets ??= {};
            this.state.booklets[this.bookletView.booklet.booklet.name] = this.bookletView.booklet.snapshot();
        }
        this.host.setState?.(this.state);
    }

    private reset(): void {
        const name = this.currentItem, booklet = this.currentBooklet;
        if (name) delete this.state.snapshots[name];
        if (name) delete this.state.judgments?.[name];
        if (booklet) delete this.state.booklets?.[booklet];
        this.bookletView?.dispose();
        this.bookletView = undefined;
        this.unmount();
        this.mount();
    }

    // --- Toolbar ---------------------------------------------------------------------

    private renderTabs(): void {
        const tabs = this.tabs;
        this.el.tabs.replaceChildren(...tabs.map(tab => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = tab.label;
            button.setAttribute('aria-pressed', String(tab.key === this.currentTab));
            button.addEventListener('click', () => {
                this.saveSnapshot();
                this.state.item = tab.key;
                this.renderTabs();
                this.mount();
            });
            return button;
        }));
        this.el.tabs.hidden = tabs.length <= 1;
    }

    private renderPages(instance: ItemInstance): void {
        if (instance.pageCount <= 1) {
            this.el.pages.replaceChildren();
            return;
        }
        const page = instance.page.get();
        const button = (label: string, title: string, target: number) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.title = title;
            b.disabled = target < 0 || target >= instance.pageCount;
            b.addEventListener('click', () => instance.page.set(target));
            return b;
        };
        const label = document.createElement('span');
        label.textContent = `Seite ${page + 1} / ${instance.pageCount}`;
        this.el.pages.replaceChildren(button('‹', 'Vorherige Seite', page - 1), label, button('›', 'Nächste Seite', page + 1));
    }

    private renderProfileControls(): void {
        const profile = this.state.profile;
        const select = document.createElement('select');
        select.title = 'Vergrößerung';
        select.setAttribute('aria-label', 'Vergrößerung');
        for (const scale of [1, 1.5, 2, 3]) {
            const option = document.createElement('option');
            option.value = String(scale);
            option.textContent = `${scale * 100} %`;
            option.selected = (profile.display?.scale ?? 1) === scale;
            select.append(option);
        }
        select.addEventListener('change', () => this.updateProfile(p => ({ ...p, display: { ...p.display, scale: Number(select.value) } })));

        const check = (label: string, get: (p: NeedsProfile) => boolean, set: (p: NeedsProfile, v: boolean) => NeedsProfile) => {
            const wrapper = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = get(profile);
            input.addEventListener('change', () => this.updateProfile(p => set(p, input.checked)));
            wrapper.append(input, ` ${label}`);
            return wrapper;
        };
        // Practice: check responses and show feedback as in the learning app
        const practice = document.createElement('button');
        practice.type = 'button';
        practice.textContent = 'Prüfen';
        practice.title = 'Antworten prüfen und Rückmeldung zeigen (Üben)';
        practice.addEventListener('click', () => { this.practice?.check(); });
        this.el.profile.replaceChildren(
            practice,
            select,
            check('Kontrast', p => p.display?.contrast === 'high', (p, v) => ({ ...p, display: { ...p.display, contrast: v ? 'high' : 'normal' } })),
            check('Umbruch', p => p.display?.reflow === true, (p, v) => ({ ...p, display: { ...p.display, reflow: v } })),
            check('Einfache Sprache', p => p.content?.simple_language === true, (p, v) => ({ ...p, content: { ...p.content, simple_language: v } })),
            check('Leichte Sprache', p => p.content?.easy_language === true, (p, v) => ({ ...p, content: { ...p.content, easy_language: v } })),
            check('Beschreibungen', p => p.content?.extended_descriptions === true, (p, v) => ({ ...p, content: { ...p.content, extended_descriptions: v } })),
            check('Vorlesen', p => p.content?.read_aloud === 'on_demand', (p, v) => ({ ...p, content: { ...p.content, read_aloud: v ? 'on_demand' : 'off' } })),
            check('Fokus', p => p.display?.focus_emphasis === true, (p, v) => ({ ...p, display: { ...p.display, focus_emphasis: v } })),
            check('Taster', p => p.interaction?.switch_access !== undefined, (p, v) => {
                const { switch_access: _, ...interaction } = p.interaction ?? {};
                return { ...p, interaction: v ? { ...interaction, switch_access: { mode: 'step' } } : interaction };
            })
        );
    }

    private updateProfile(change: (p: NeedsProfile) => NeedsProfile): void {
        this.saveSnapshot();
        this.state.profile = change(this.state.profile);
        this.mount();
    }

    private showStatus(diagnostics: { errors: number; warnings: number }, stale = false): void {
        this.el.status.textContent = stale
            ? 'Syntaxfehler im Dokument – die Vorschau zeigt den letzten gültigen Stand.'
            : diagnostics.errors > 0 ? `${diagnostics.errors} Fehler im Dokument – fehlerhafte Stellen erscheinen als Platzhalter.` : '';
        this.el.status.hidden = !stale && diagnostics.errors === 0;
        this.el.preview.classList.toggle('studio-stale', stale);
    }

    // --- Responses and coding ---------------------------------------------------------

    /** Renders responses and coding of one item or of all items of a booklet. */
    private renderResponses(entries: Array<{ responses: ResponseSet; coding: CodingResult }>, accommodations: ReadonlySet<string>): void {
        const multiple = entries.length > 1;
        const codeCell = (c: VariableCode | undefined): string => !c ? '<span class="muted">keine Kodierung</span>'
            : c.error ? `<span class="error">${esc(c.error)}</span>`
            : c.pending ? '<span class="pending">offen: manuell</span>'
            : c.missing ? `<span class="missing">${esc(c.missing)}</span>`
            : `<strong>${c.code}</strong>${c.label ? ` <span class="muted">${esc(c.label)}</span>` : ''}`;
        const rows = entries.flatMap(({ responses, coding }) => {
            const prefix = multiple ? `<span class="muted">${esc(responses.item)}.</span>` : '';
            const answers = Object.entries(responses.variables).map(([name, r]) => {
                const c = coding.variables[name];
                const flags = [r.displayed ? 'angezeigt' : 'nicht angezeigt', r.changed ? 'verändert' : 'unverändert'];
                return `<tr>
                  <th scope="row">${prefix}${esc(name)}</th>
                  <td><code>${esc(JSON.stringify(r.value))}</code><div class="flags">${flags.join(' · ')}</div></td>
                  <td>${codeCell(c)}</td>
                  <td class="num">${c?.score ?? ''}</td>
                </tr>`;
            });
            // Sub-tasks spanning several responses
            const units = Object.entries(coding.variables).filter(([name]) => !(name in responses.variables)).map(([name, c]) => `<tr>
                  <th scope="row">${prefix}${esc(name)}</th>
                  <td><span class="muted">Teilaufgabe</span></td>
                  <td>${codeCell(c)}</td>
                  <td class="num">${c.score ?? ''}</td>
                </tr>`);
            // Open questions for human coders, simulated with yes/no buttons
            const questions = Object.entries(coding.variables).flatMap(([name, c]) => (c.pending ?? []).map(q => `<tr class="judge">
                  <td colspan="4">
                    <div><strong>${prefix}${esc(name)}</strong> – ${esc(q.criterion)}</div>
                    ${(q.answers ?? []).map(a => `<div class="judge-answer"><span class="muted">${esc(a)}:</span> ${esc(answerText(responses.variables[a]?.value))}</div>`).join('')}
                    ${q.yes.length ? `<div class="muted">richtig z. B.: ${q.yes.map(esc).join(' · ')}</div>` : ''}
                    ${q.no.length ? `<div class="muted">falsch z. B.: ${q.no.map(esc).join(' · ')}</div>` : ''}
                    <div class="judge-buttons">
                      <button type="button" data-item="${esc(responses.item)}" data-question="${esc(q.id)}" data-verdict="yes">trifft zu</button>
                      <button type="button" data-item="${esc(responses.item)}" data-question="${esc(q.id)}" data-verdict="no">trifft nicht zu</button>
                    </div>
                  </td>
                </tr>`));
            return [...answers, ...units, ...questions];
        }).join('');
        const judged = entries.some(({ responses }) => Object.keys(this.state.judgments?.[responses.item] ?? {}).length > 0);
        const scores = entries.flatMap(({ responses, coding }) => Object.entries(coding.scores)
            .map(([n, v]) => `<div class="score"><span>${multiple ? esc(responses.item) + '.' : ''}${esc(n)}</span><strong>${v}</strong></div>`)).join('');
        const list = accommodations.size > 0 ? [...accommodations].sort().join(', ') : 'keine';
        this.el.responses.innerHTML = `
          <table>
            <thead><tr><th scope="col">Variable</th><th scope="col">Wert</th><th scope="col">Code</th><th scope="col">Score</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          ${scores}
          ${judged ? '<p><button type="button" data-clear-judgments>Urteile verwerfen</button></p>' : ''}
          <p class="muted">Wirksame Anpassungen: ${esc(list)}</p>`;
    }

    // --- Audio phases (preview only) ---------------------------------------------------------------

    private showSkip(visible: boolean): void {
        const button = this.el.main.ownerDocument.querySelector<HTMLButtonElement>('.studio-skip');
        if (button) button.hidden = !visible;
    }

    /** Ends the running play, else lets the running timers elapse (reading time, pause) in the item or the current booklet item. */
    private skipPhase(): void {
        const clock = this.instance?.clock ?? this.bookletView?.booklet.current.peek().clock;
        clock?.skip();
    }

    // --- Manual coding (simulated) ---------------------------------------------------------

    private judgmentsOf(item: string): Judgments {
        this.judged.get();
        return this.state.judgments?.[item] ?? {};
    }

    private onJudge(e: MouseEvent): void {
        const button = (e.target as Element).closest('button');
        if (!button) return;
        if (button.hasAttribute('data-clear-judgments')) {
            this.state.judgments = {};
        } else if (button.dataset.question && button.dataset.item) {
            const all = this.state.judgments ??= {};
            (all[button.dataset.item] ??= {})[button.dataset.question] = button.dataset.verdict === 'yes';
        } else {
            return;
        }
        this.host.setState?.(this.state);
        this.judged.set(this.judged.peek() + 1);
    }

    // --- Source mapping -------------------------------------------------------------------------

    private onPreviewClick(e: MouseEvent): void {
        if (!e.altKey || this.designer) return;
        const target = (e.target as Element).closest('[data-src]');
        const src = target?.getAttribute('data-src');
        if (!src) return;
        e.preventDefault();
        e.stopPropagation();
        this.host.post({ kind: 'select', src: src.split(':').map(Number) as Src, focus: true });
    }

    private reveal(offset: number): void {
        this.el.preview.querySelectorAll('.af-studio-reveal').forEach(e => e.classList.remove('af-studio-reveal'));
        let best: { el: Element; length: number } | undefined;
        for (const el of this.el.preview.querySelectorAll('[data-src]')) {
            const [doc, start, end] = el.getAttribute('data-src')!.split(':').map(Number);
            if (doc !== 0 || offset < start || offset > end) continue;
            if (!best || end - start < best.length) best = { el, length: end - start };
        }
        if (best) {
            best.el.classList.add('af-studio-reveal');
            best.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}

function esc(s: string): string {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
