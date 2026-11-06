import type { Bundle } from '@answerfield/bundle';
import type { DiagnosticInfo, EditIntent, NodeDescription, PaletteEntry } from '@answerfield/editing';

/** Request to the language server: dev bundle of a document. */
export const DEV_BUNDLE_REQUEST = 'af/devBundle';
/** Request: turn a visual editor intent into a text edit. */
export const EDIT_REQUEST = 'af/edit';
/** Request: describe a node for the properties form. */
export const DESCRIBE_REQUEST = 'af/describe';
/** Request: building blocks for the visual editor's palette. */
export const PALETTE_REQUEST = 'af/palette';
/** Server notification: documents were revalidated. */
export const VALIDATED_NOTIFICATION = 'af/validated';

/** Parameters of DEV_BUNDLE_REQUEST. */
export interface DevBundleParams {
    uri: string;
}

/** Result of DEV_BUNDLE_REQUEST. */
export interface DevBundleResult {
    bundle: Bundle;
    /** Document version that node IDs and offsets refer to. */
    version: number;
    /** All involved documents (items, components, codings); changes to any of them refresh the preview. */
    documents?: string[];
    diagnostics: { errors: number; warnings: number; syntax: number; list: DiagnosticInfo[] };
}

/** Parameters of EDIT_REQUEST; `version` must match the current document version. */
export interface EditParams {
    uri: string;
    version: number;
    intent: EditIntent;
}

/** Text edits for an intent (plus an optional offset to select afterwards), or an error message. */
export type EditResponse =
    | { ok: true; edits: Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>; select?: number }
    | { ok: false; error: string };

/** Parameters of DESCRIBE_REQUEST; `node` is the node ID from the dev bundle. */
export interface DescribeParams {
    uri: string;
    node: string;
}

export type DescribeResponse = NodeDescription | null;

/** Parameters of PALETTE_REQUEST: the edited document (its folder decides which own components are offered). */
export interface PaletteParams {
    uri?: string;
}

export type PaletteResponse = PaletteEntry[];
