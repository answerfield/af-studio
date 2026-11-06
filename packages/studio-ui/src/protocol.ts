import type { Bundle, CodingResult, ResponseSet, Src } from '@answerfield/bundle';
import type { DiagnosticInfo, EditIntent, NodeDescription, PaletteEntry } from '@answerfield/designer';

/** Messages from the host (VS Code, web editor) to studio-ui. */
export type ToStudio =
    | {
        kind: 'bundle'; bundle: Bundle; uri: string; baseUrl?: string;
        /** Document version the node ids refer to (sent back with edits). */
        version?: number;
        diagnostics: { errors: number; warnings: number; syntax?: number; list?: DiagnosticInfo[] };
    }
    /** Reply to a request (describe, palette, edit). */
    | { kind: 'reply'; requestId: number; result: unknown }
    /** Text cursor moved: highlight the matching element (offset in the main document). */
    | { kind: 'reveal'; offset: number };

/** Messages from studio-ui to the host. */
export type FromStudio =
    | { kind: 'ready' }
    /** Reveal source: Alt+click in the preview (`focus`) or a selection in the designer. */
    | { kind: 'select'; src: Src; focus?: boolean }
    /** Describe a node for the properties panel → reply: NodeDescription | null */
    | { kind: 'describe'; requestId: number; node: string }
    /** Building blocks for the palette → reply: PaletteEntry[] */
    | { kind: 'palette'; requestId: number }
    /** Apply a designer edit intent → reply: EditReply */
    | { kind: 'edit'; requestId: number; version: number; intent: EditIntent }
    /** Current responses and their coding (e.g. for the host's output view). */
    | { kind: 'responses'; responses: ResponseSet; coding: CodingResult };

/** Transport between studio-ui and its host. */
export interface StudioHost {
    post(message: FromStudio): void;
    /** Persistent host state (e.g. webview state). */
    getState?(): unknown;
    setState?(state: unknown): void;
}

/** Result of an `edit` request. */
export interface EditReply {
    ok: boolean;
    error?: string;
    /** Offset of the edited node in the new text, to select it after the rebuild. */
    select?: number;
}

export type { NodeDescription, PaletteEntry };
