// Builds the playground into dist/: page, language worker, studio preview, and the examples (texts in
// examples.json, media next to it). `--serve` rebuilds on changes and serves dist/ on http://localhost:8100.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
const serve = process.argv.includes('--serve');
const minify = process.argv.includes('--minify');

// Own examples only
const EXAMPLES = [
    { folder: 'basic', label: 'Einzelne Aufgaben' },
    { folder: 'basic/fractions', label: 'Testheft „Brüche verstehen“' },
    { folder: 'learning/fractions', label: 'Lernreihe „Brüche entdecken“ (mit Rückmeldung)' }
];

function examples() {
    const root = join(here, '../../examples');
    const groups = EXAMPLES.map(({ folder, label }) => {
        const dir = join(root, folder);
        const entries = readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile());
        mkdirSync(join(out, 'examples', folder), { recursive: true });
        for (const e of entries.filter(e => !e.name.endsWith('.af'))) copyFileSync(join(dir, e.name), join(out, 'examples', folder, e.name));
        const files = entries.filter(e => e.name.endsWith('.af')).map(e => {
            const text = readFileSync(join(dir, e.name), 'utf8');
            const title = /^\s*(?:item|booklet)\s+\w+\s+"([^"]+)"/m.exec(text)?.[1] ?? e.name.replace(/\.af$/, '');
            return { name: e.name, title, text };
        });
        return { folder, label, files };
    });
    writeFileSync(join(out, 'examples.json'), JSON.stringify({ groups }));
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const page of ['index.html', 'studio.html']) copyFileSync(join(here, 'src', page), join(out, page));
examples();

const ctx = await esbuild.context({
    entryPoints: { app: 'src/main.ts', worker: 'src/worker.ts', studio: '@answerfield/studio-ui/webview' },
    outdir: out,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    conditions: ['af-source'],
    sourcemap: !minify,
    minify,
    logLevel: 'info'
});

if (serve) {
    await ctx.watch();
    const { port } = await ctx.serve({ servedir: out, port: 8100 });
    console.log(`Playground: http://localhost:${port}`);
} else {
    await ctx.rebuild();
    await ctx.dispose();
}
