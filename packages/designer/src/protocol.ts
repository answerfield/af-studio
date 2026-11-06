import type { EditIntent, EditOutcome, NodeDescription, PaletteEntry } from '@answerfield/editing';

export type { DiagnosticInfo, DropPosition, EditIntent, EditOutcome, NodeDescription, PaletteEntry, ParamDescription, PointHandle, ValueDescription } from '@answerfield/editing';

/**
 * Services the designer needs from its host (VS Code extension or web app). All edits go through the host;
 * the designer never mutates the tree itself.
 */
export interface DesignerHost {
    /** Describes a node (parameters, values, points) for the properties panel. */
    describe(node: string): Promise<NodeDescription | undefined>;
    /** Building blocks for the palette (elements and components that can be inserted). */
    palette(): Promise<PaletteEntry[]>;
    /** Applies an edit to the source text. */
    edit(intent: EditIntent): Promise<EditOutcome>;
    /** Selection changed (to sync the text editor cursor). */
    selected(node: { id: string; src?: [number, number, number] } | undefined): void;
    /** Reveals this source range in the text editor. */
    showSource(src: [number, number, number]): void;
}
