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
    releasePackage();
}

/**
 * dist/ as a package of its own (release file of af-studio, used by the docs site): package.json with name, version,
 * description, license and repository of the app, its LICENSE, and a README naming the license of the examples.
 */
function releasePackage() {
    const app = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
    const fields = Object.fromEntries(['name', 'version', 'description', 'license', 'repository'].filter(k => k in app).map(k => [k, app[k]]));
    writeFileSync(join(out, 'package.json'), `${JSON.stringify(fields, null, 2)}\n`);
    try {
        copyFileSync(join(here, 'LICENSE'), join(out, 'LICENSE'));
    } catch {
        // no LICENSE next to the app (inside the monorepo); the exported repository has one
    }
    writeFileSync(join(out, 'README.md'), [
        `# ${app.name}`,
        '',
        'Der gebaute Playground: statische Dateien, die ein Webserver ausliefert (index.html, app.js, worker.js,',
        'studio.html, studio.js). Die Beispielaufgaben unter examples/ stehen unter CC0-1.0, alles andere unter der',
        'Lizenz in LICENSE.',
        ''
    ].join('\n'));
}
