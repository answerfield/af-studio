// Bundles the extension and the language server into one CommonJS file each, plus the preview webview script.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The TextMate grammar is generated into the language package; copy it next to the extension manifest (git-ignored).
mkdirSync('syntaxes', { recursive: true });
copyFileSync(
    fileURLToPath(import.meta.resolve('@answerfield/language/syntaxes/af.tmLanguage.json')),
    'syntaxes/af.tmLanguage.json'
);

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

const common = {
    bundle: true,
    target: 'es2022',
    conditions: ['af-source'],
    sourcemap: !minify,
    minify,
    logLevel: 'info'
};

// Extension and language server (Node)
const node = await esbuild.context({
    ...common,
    entryPoints: {
        'extension': 'src/extension.ts',
        'server': 'src/server.ts'
    },
    outdir: 'out',
    outExtension: { '.js': '.cjs' },
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    // import.meta.url is not available in CommonJS; shim it via __filename
    define: { 'import.meta.url': 'importMetaUrl' },
    banner: { js: "const importMetaUrl = require('url').pathToFileURL(__filename).href;" }
});

// Preview and visual editor (webview, browser)
const studio = await esbuild.context({
    ...common,
    entryPoints: { 'studio/studio': '@answerfield/studio-ui/webview' },
    outdir: 'out',
    format: 'iife',
    platform: 'browser'
});

for (const ctx of [node, studio]) {
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}
