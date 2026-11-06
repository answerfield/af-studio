// Integration test in a real VS Code instance (local install, or VSCODE_PATH).
import { runTests } from '@vscode/test-electron';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const local = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
// Short path: VS Code creates an IPC socket there (max. 103 characters)
const userData = mkdtempSync(join(process.env.AF_TEST_TMP ?? tmpdir(), 'afvs-'));

// When run from VS Code's integrated terminal, do not connect to the running instance
for (const key of Object.keys(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) delete process.env[key];
}
try {
    await runTests({
        ...(process.env.VSCODE_PATH ? { vscodeExecutablePath: process.env.VSCODE_PATH } : { vscodeExecutablePath: local }),
        extensionDevelopmentPath: join(here, '..'),
        extensionTestsPath: join(here, 'suite.cjs'),
        launchArgs: [join(root, 'examples'), '--disable-extensions', '--user-data-dir', userData, '--skip-welcome', '--skip-release-notes']
    });
} catch (e) {
    console.error('Integrationstest fehlgeschlagen:', e);
    process.exit(1);
}
