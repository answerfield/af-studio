/** Studio chrome styles; uses VS Code theme colors when available. The item itself uses the runtime theme. */
export const STUDIO_CSS = /* css */ `
.af-studio {
  --s-fg: var(--vscode-foreground, #1d2433);
  --s-bg: var(--vscode-editor-background, #ffffff);
  --s-muted: var(--vscode-descriptionForeground, #5b6475);
  --s-border: var(--vscode-panel-border, #d0d5dd);
  --s-surface: var(--vscode-sideBar-background, #f4f6fa);
  --s-accent: var(--vscode-focusBorder, #1f5fbf);
  --s-error: var(--vscode-errorForeground, #b3261e);
  --s-button-bg: var(--vscode-button-secondaryBackground, #e7eaf0);
  --s-button-fg: var(--vscode-button-secondaryForeground, #1d2433);
  display: flex; flex-direction: column; height: 100vh; margin: 0;
  font-family: var(--vscode-font-family, system-ui, sans-serif); font-size: var(--vscode-font-size, 13px);
  color: var(--s-fg); background: var(--s-bg);
}
.af-studio button, .af-studio select {
  font: inherit; color: var(--s-button-fg); background: var(--s-button-bg);
  border: 1px solid var(--s-border); border-radius: 4px; padding: 2px 8px; cursor: pointer;
}
.af-studio button:disabled { opacity: 0.4; cursor: default; }
.af-studio button[aria-pressed="true"] { border-color: var(--s-accent); box-shadow: inset 0 -2px 0 var(--s-accent); }
.studio-toolbar {
  display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
  padding: 6px 12px; border-bottom: 1px solid var(--s-border); background: var(--s-surface);
}
.studio-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.studio-profile { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.studio-profile label { display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
.studio-pages { display: flex; gap: 6px; align-items: center; }
.studio-reset { margin-left: auto; }
.studio-status { padding: 4px 12px; color: var(--s-error); border-bottom: 1px solid var(--s-border); }
/* Preview on top, responses and coding below, scrolling together.
   In design mode the properties panel sits on the right. */
.studio-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.studio-main-design { grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem); }
.studio-scroll { min-height: 0; overflow: auto; display: flex; flex-direction: column; }
.studio-properties { min-height: 0; overflow: auto; border-left: 1px solid var(--s-border); background: var(--s-surface); }
.studio-modes { display: flex; }
.studio-modes button { border-radius: 0; }
.studio-modes button:first-child { border-radius: 4px 0 0 4px; }
.studio-modes button:last-child { border-radius: 0 4px 4px 0; border-left: none; }
.studio-modes button[aria-pressed="true"] { background: var(--vscode-button-background, #1f5fbf); color: var(--vscode-button-foreground, #fff); box-shadow: none; }
.studio-preview { background: #e9ecf1; padding: 16px; }
.studio-preview af-root { max-width: 52rem; margin: 0 auto; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.15); min-height: 8rem; }
.studio-empty { color: var(--s-muted); text-align: center; margin-top: 3rem; }
.studio-side { border-top: 1px solid var(--s-border); padding: 8px 16px 16px; }
.studio-side > * { max-width: 52rem; margin-inline: auto; }
.studio-side h2 { font-size: 1em; margin: 4px auto 8px; text-transform: uppercase; letter-spacing: .04em; color: var(--s-muted); }
.studio-side table { width: 100%; border-collapse: collapse; }
.studio-side th, .studio-side td { text-align: left; vertical-align: top; padding: 4px 6px; border-bottom: 1px solid var(--s-border); }
.studio-side thead th { font-weight: 600; color: var(--s-muted); }
.studio-side td.num, .studio-side thead th:last-child { text-align: right; }
.studio-side code { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); word-break: break-all; }
.studio-side .flags, .studio-side .muted { color: var(--s-muted); font-size: .92em; }
.studio-side .missing { font-style: italic; }
.studio-adaptation { margin-top: 16px; }
.studio-adaptation p { margin: 4px 0; }
.studio-adaptation details { margin: 0 0 6px 1em; color: var(--s-muted); }
.studio-adaptation ul { margin: 4px 0; padding-left: 1.2em; }
.studio-side .pending { color: var(--s-warning, #b26a00); font-weight: 600; }
.studio-side tr.judge td { border-bottom: 1px dashed var(--s-border); }
.studio-side .judge-buttons { display: flex; gap: 6px; margin-top: 4px; }
.studio-side .error { color: var(--s-error); }
.studio-side .score { display: flex; justify-content: space-between; padding: 6px; font-size: 1.1em; border-bottom: 2px solid var(--s-border); }
.studio-stale > af-root { opacity: .6; }
.booklet-bar {
  position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
  max-width: 52rem; margin: 0 auto 12px; padding: 8px 12px; border-radius: 6px;
  background: var(--s-bg); color: var(--s-fg); box-shadow: 0 1px 3px rgba(0,0,0,.15);
}
.booklet-part { font-weight: 600; }
.booklet-progress { color: var(--s-muted); }
.booklet-timer { font-variant-numeric: tabular-nums; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: var(--s-surface); }
.booklet-timer-low { color: #fff; background: var(--s-error); }
.booklet-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.booklet-actions button.primary { background: var(--vscode-button-background, #1f5fbf); color: var(--vscode-button-foreground, #fff); border-color: transparent; }
.booklet-confirm { color: var(--s-muted); }
.booklet-finished { max-width: 52rem; margin: 2rem auto; text-align: center; font-size: 1.2em; }
.af-studio-reveal { outline: 2px dashed var(--s-accent) !important; outline-offset: 3px; }
.studio-preview [data-src] { cursor: default; }
`;
