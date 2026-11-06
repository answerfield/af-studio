// Entry point for the VS Code webview or a standalone page (posts to the parent window).
import { Studio } from './studio.js';
import type { FromStudio, StudioHost, ToStudio } from './protocol.js';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
const host: StudioHost = vscode
    ? { post: m => vscode.postMessage(m), getState: () => vscode.getState(), setState: s => vscode.setState(s) }
    : { post: (m: FromStudio) => window.parent?.postMessage(m, '*') };

const container = document.getElementById('studio') ?? document.body.appendChild(document.createElement('div'));
const studio = new Studio(container, host);
window.addEventListener('message', (e: MessageEvent<ToStudio>) => {
    if (e.data && typeof e.data === 'object' && 'kind' in e.data) studio.receive(e.data);
});
