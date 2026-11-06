import type { Bundle } from '@answerfield/bundle';
import type { DiagnosticInfo, EditIntent, NodeDescription, PaletteEntry } from '@answerfield/editing';

/** Messages from the page to the language worker. */
export type ToWorker =
    /** Load all example files (uri → text) once. */
    | { kind: 'open'; files: Record<string, string>; main: string }
    /** Text of a file changed; `version` grows monotonically. */
    | { kind: 'change'; uri: string; text: string; version: number }
    /** Preview another file. */
    | { kind: 'main'; uri: string }
    | ({ id: number } & WorkerRequest);

export type WorkerRequest =
    | { kind: 'complete'; offset: number }
    | { kind: 'hover'; offset: number }
    | { kind: 'describe'; node: string }
    | { kind: 'palette' }
    | { kind: 'edit'; version: number; intent: EditIntent };

/** Messages from the language worker to the page. */
export type FromWorker =
    /** Result of a build of the previewed file; `bundle` is missing if the compiler failed. */
    | { kind: 'built'; uri: string; version: number; bundle?: Bundle; diagnostics: Diagnostics }
    | { kind: 'reply'; id: number; result: unknown }
    | { kind: 'error'; message: string };

export interface Diagnostics {
    errors: number;
    warnings: number;
    syntax: number;
    list: DiagnosticInfo[];
}

export interface CompletionResult {
    /** Offset where the completed word starts. */
    from: number;
    items: Array<{ label: string; detail?: string; info?: string; type?: string; apply: string }>;
}

export type EditResult =
    | { ok: true; edits: Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>; select?: number }
    | { ok: false; error: string };

export type { NodeDescription, PaletteEntry };
