import * as vscode from 'vscode';

/** Node of the structure tree, with a parent link (needed for reveal). */
export interface StructureNode {
    symbol: vscode.DocumentSymbol;
    parent?: StructureNode;
    children: StructureNode[];
}

const ICONS: Partial<Record<vscode.SymbolKind, string>> = {
    [vscode.SymbolKind.Class]: 'symbol-class',
    [vscode.SymbolKind.Interface]: 'symbol-interface',
    [vscode.SymbolKind.Function]: 'symbol-method',
    [vscode.SymbolKind.Package]: 'package',
    [vscode.SymbolKind.Namespace]: 'symbol-namespace',
    [vscode.SymbolKind.Module]: 'info',
    [vscode.SymbolKind.Field]: 'symbol-field',
    [vscode.SymbolKind.Variable]: 'symbol-variable',
    [vscode.SymbolKind.Constant]: 'symbol-constant',
    [vscode.SymbolKind.Boolean]: 'eye',
    [vscode.SymbolKind.Array]: 'symbol-array',
    [vscode.SymbolKind.Event]: 'symbol-event',
    [vscode.SymbolKind.EnumMember]: 'symbol-enum-member',
    [vscode.SymbolKind.Property]: 'symbol-property',
    [vscode.SymbolKind.String]: 'symbol-string',
    [vscode.SymbolKind.Struct]: 'symbol-structure',
    [vscode.SymbolKind.Object]: 'symbol-object',
    [vscode.SymbolKind.Number]: 'symbol-numeric'
};

/**
 * The "AF-Struktur" view: document outline for the AF editor (the built-in outline shows nothing for custom
 * editors). Clicking selects the node in the visual editor; the view follows the selection.
 */
export class StructureProvider implements vscode.TreeDataProvider<StructureNode> {
    private readonly changed = new vscode.EventEmitter<StructureNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private document?: vscode.Uri;
    private roots: StructureNode[] = [];
    private loading?: Promise<void>;
    private refreshTimer?: ReturnType<typeof setTimeout>;
    view?: vscode.TreeView<StructureNode>;

    /** Sets the document shown (that of the active AF editor, or none). */
    setDocument(uri: vscode.Uri | undefined): void {
        if (uri?.toString() === this.document?.toString()) return;
        this.document = uri;
        this.refresh();
    }

    get uri(): vscode.Uri | undefined {
        return this.document;
    }

    /** Reloads debounced, e.g. after each language server validation. */
    scheduleRefresh(): void {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.refresh(), 150);
    }

    refresh(): void {
        this.loading = this.load();
        void this.loading.then(() => this.changed.fire(undefined));
    }

    private async load(): Promise<void> {
        if (!this.document) {
            this.roots = [];
            return;
        }
        let symbols: vscode.DocumentSymbol[] | undefined;
        try {
            symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
                'vscode.executeDocumentSymbolProvider', this.document);
        } catch {
            symbols = undefined; // document closed or server restarting: show an empty view instead of an error
        }
        const wrap = (symbol: vscode.DocumentSymbol, parent?: StructureNode): StructureNode => {
            const node: StructureNode = { symbol, parent, children: [] };
            node.children = (symbol.children ?? []).map(c => wrap(c, node));
            return node;
        };
        this.roots = (symbols ?? []).filter(s => 'children' in s).map(s => wrap(s));
    }

    getChildren(node?: StructureNode): StructureNode[] {
        return node ? node.children : this.roots;
    }

    getParent(node: StructureNode): StructureNode | undefined {
        return node.parent;
    }

    getTreeItem(node: StructureNode): vscode.TreeItem {
        const { symbol } = node;
        const item = new vscode.TreeItem(symbol.name,
            node.children.length === 0 ? vscode.TreeItemCollapsibleState.None
                : symbol.kind === vscode.SymbolKind.Function ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded);
        item.description = symbol.detail;
        item.tooltip = symbol.detail ? `${symbol.name} – ${symbol.detail}` : symbol.name;
        item.iconPath = new vscode.ThemeIcon(ICONS[symbol.kind] ?? 'symbol-misc');
        item.id = `${symbol.range.start.line}:${symbol.range.start.character}:${symbol.name}`;
        if (this.document) {
            item.command = { command: 'af.revealNode', title: 'Auswählen', arguments: [this.document, symbol.range] };
        }
        return item;
    }

    /** Selects the innermost node containing the position (follows the visual editor's selection). */
    async reveal(uri: vscode.Uri, position: vscode.Position): Promise<void> {
        if (!this.view?.visible || uri.toString() !== this.document?.toString()) return;
        await this.loading;
        let best: StructureNode | undefined;
        const visit = (nodes: StructureNode[]) => {
            for (const n of nodes) {
                if (!n.symbol.range.contains(position)) continue;
                best = n;
                visit(n.children);
            }
        };
        visit(this.roots);
        // The tree may have been rebuilt meanwhile, in which case the node no longer exists
        if (best) await this.view.reveal(best, { select: true, focus: false, expand: true }).then(undefined, () => undefined);
    }
}
