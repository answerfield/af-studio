/** Styles for the designer overlay, palette and properties panel; installed once per document. */
export const DESIGNER_CSS = /* css */ `
.studio-design { position: relative; outline: none; cursor: default; }
.studio-design af-root { user-select: none; }
.studio-design af-root * { cursor: default !important; }
/* Conditional content stays visible while designing, but dimmed */
.studio-design af-root af-show[hidden] { display: contents !important; }
.studio-design af-root af-show[hidden] > * { opacity: .45; }
.designer-layer { position: absolute; inset: 0; pointer-events: none; z-index: 10; }
.designer-hover, .designer-selection { position: absolute; border-radius: 4px; box-sizing: border-box; }
.designer-hover { border: 1px dashed var(--s-accent, #1f5fbf); }
.designer-selection { border: 2px solid var(--s-accent, #1f5fbf); background: color-mix(in srgb, var(--s-accent, #1f5fbf) 6%, transparent); }
.studio-design:focus-visible .designer-selection { box-shadow: 0 0 0 2px color-mix(in srgb, var(--s-accent, #1f5fbf) 35%, transparent); }
.designer-label {
  position: absolute; left: -2px; top: -1.6em; padding: 1px 6px; border-radius: 3px 3px 0 0;
  font: 11px/1.4 var(--vscode-font-family, system-ui, sans-serif); white-space: nowrap;
  background: var(--s-accent, #1f5fbf); color: #fff;
}
/* The selection label doubles as the drag handle for moving */
.designer-label { pointer-events: auto; cursor: grab; }
.designer-label::before { content: "⠿ "; opacity: .8; }
.designer-drop-line { position: absolute; background: var(--s-accent, #1f5fbf); border-radius: 2px; box-shadow: 0 0 0 1px #fff; }
.designer-drop-box { position: absolute; border: 2px dashed var(--s-accent, #1f5fbf); border-radius: 4px; background: color-mix(in srgb, var(--s-accent, #1f5fbf) 10%, transparent); }
.designer-drop-line[hidden], .designer-drop-box[hidden] { display: none; }
/* Interactive controls above the preview */
.designer-tools { position: absolute; inset: 0; pointer-events: none; z-index: 11; }
.designer-tools > * { pointer-events: auto; }
.designer-tools > .designer-announce { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.designer-tools .designer-inline {
  position: absolute; box-sizing: border-box; padding: 2px 4px; resize: none; overflow: hidden;
  border: 2px solid var(--s-accent, #1f5fbf); border-radius: 3px; background: var(--vscode-input-background, #fff); color: inherit;
  box-shadow: 0 2px 8px rgb(0 0 0 / .2);
}
.designer-tools .designer-handle {
  position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; padding: 0; border-radius: 50%;
  border: 2px solid #fff; background: var(--s-accent, #1f5fbf); box-shadow: 0 0 0 1px var(--s-accent, #1f5fbf), 0 1px 4px rgb(0 0 0 / .3);
  cursor: grab; touch-action: none;
}
.designer-tools .designer-handle[data-dragging] { cursor: grabbing; transform: scale(1.2); }
.designer-handle:focus-visible { outline: 2px solid var(--s-accent, #1f5fbf); outline-offset: 3px; }
.designer-handle:is(:hover, :focus-visible, [data-dragging])::after {
  content: attr(data-coords); position: absolute; left: 50%; top: 22px; transform: translateX(-50%); white-space: nowrap;
  font: 11px/1.4 var(--vscode-font-family, system-ui, sans-serif); padding: 1px 5px; border-radius: 3px; background: #1d2433; color: #fff;
}
/* Palette */
.designer-palette { padding: 8px 12px 10px; border-bottom: 1px solid var(--s-border, #d0d5dd); }
.designer-palette h3 { margin: 0 0 2px; font-size: 1.05em; }
.designer-palette > .designer-muted { margin: 0 0 6px; font-size: .92em; }
.designer-palette input[type="search"] {
  width: 100%; box-sizing: border-box; font: inherit; padding: 3px 6px; margin-bottom: 6px;
  color: var(--vscode-input-foreground, inherit); background: var(--vscode-input-background, #fff);
  border: 1px solid var(--vscode-input-border, var(--s-border, #d0d5dd)); border-radius: 3px;
}
.designer-palette-group summary { cursor: pointer; font-weight: 600; padding: 2px 0; }
.designer-palette-items { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0 6px; }
.designer-palette-entry {
  font: 12px/1.3 var(--vscode-editor-font-family, ui-monospace, monospace); padding: 3px 7px; border-radius: 4px; cursor: grab;
  border: 1px solid var(--s-border, #d0d5dd); background: var(--vscode-button-secondaryBackground, #f4f6f9); color: inherit;
}
.designer-palette-entry:hover, .designer-palette-entry:focus-visible { border-color: var(--s-accent, #1f5fbf); }
.designer-palette-status { margin: 4px 0 0; font-size: .92em; color: var(--s-muted, #5b6475); }
.designer-palette-status:empty { display: none; }
.designer-badge {
  position: absolute; min-width: 18px; height: 18px; border-radius: 9px; padding: 0 4px; box-sizing: border-box;
  font: 600 11px/18px var(--vscode-font-family, system-ui, sans-serif); text-align: center; color: #fff;
}
.designer-badge.error { background: var(--s-error, #b3261e); }
.designer-badge.warning { background: #b26a00; }

.designer-path {
  display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 6px 12px;
  border-bottom: 1px solid var(--s-border, #d0d5dd); font-size: .92em;
}
.designer-path button { border: none; background: none; padding: 1px 4px; margin: 0; color: var(--s-accent, #1f5fbf); cursor: pointer; border-radius: 3px; }
.designer-path button:hover { text-decoration: underline; }
.designer-path button[aria-current="true"] { color: inherit; font-weight: 600; cursor: default; text-decoration: none; }
.designer-path-sep { color: var(--s-muted, #5b6475); }
.designer-properties { padding: 8px 12px 16px; }
.designer-properties header { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.designer-properties h3 { margin: 0; font-size: 1.1em; }
.designer-actions { display: flex; gap: 6px; }
.designer-actions .danger { color: var(--s-error, #b3261e); }
.designer-doc, .designer-muted, .designer-help { color: var(--s-muted, #5b6475); }
.designer-doc { margin: 0 0 10px; }
.designer-help { font-size: .92em; margin-top: 2px; }
.designer-field { margin-bottom: 12px; }
.designer-field > label { display: flex; gap: 6px; align-items: baseline; font-weight: 600; margin-bottom: 3px; }
.designer-type { margin-left: auto; font-weight: normal; color: var(--s-muted, #5b6475); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: .9em; }
.designer-required { color: var(--s-error, #b3261e); }
.designer-field input, .designer-field select, .designer-field textarea {
  width: 100%; box-sizing: border-box; font: inherit; padding: 3px 6px;
  color: var(--vscode-input-foreground, inherit); background: var(--vscode-input-background, #fff);
  border: 1px solid var(--vscode-input-border, var(--s-border, #d0d5dd)); border-radius: 3px;
}
.designer-field input:focus, .designer-field select:focus, .designer-field textarea:focus { outline: 1px solid var(--s-accent, #1f5fbf); outline-offset: -1px; }
.designer-expression { font-family: var(--vscode-editor-font-family, ui-monospace, monospace) !important; }
.designer-list { display: flex; flex-direction: column; gap: 4px; }
.designer-list-row { display: flex; gap: 4px; }
.designer-list-row button { flex: none; padding: 0 6px; }
.designer-add { align-self: flex-start; }
.designer-interval { display: flex; gap: 6px; align-items: center; }
.designer-error { color: var(--s-error, #b3261e); font-size: .92em; }
.designer-error:empty { display: none; }
.designer-diagnostics { margin: 0 0 10px; padding-left: 1.2em; }
.designer-diagnostics .error { color: var(--s-error, #b3261e); }
.designer-diagnostics .warning { color: #b26a00; }
`;
