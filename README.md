# af-studio

answerfield ist eine typisierte, deklarativ-reaktive Sprache für digitale Assessments. Dieses Repository enthält das Studio: Erweiterung für VS Code, Designer und Playground.

## Pakete

| Paket | Inhalt |
|---|---|
| `af-vscode` | Erweiterung für Visual Studio Code |
| `@answerfield/studio-ui` | Oberfläche des Studios: Vorschau, Designer, Prüfen |
| `@answerfield/designer` | Visueller Designer für Aufgaben |
| `@answerfield/playground` | Web-Editor mit Vorschau, Sprache und Compiler laufen im Browser |

Die Pakete liegen als Dateien an den [Releases](https://github.com/answerfield/af-studio/releases).

## Bauen und testen

Voraussetzung ist Node.js 22.12 oder neuer.

```sh
npm ci && npm run build && npm test
```

## Lizenzen

| Pfad | Lizenz |
|---|---|
| `examples` | CC0-1.0 |
| alles andere (Code) | Apache-2.0 |

Die Lizenz jeder Datei steht in `REUSE.toml`, die Lizenztexte liegen in `LICENSES/`.

## Mitwirken

Issues und Pull Requests sind willkommen, siehe [CONTRIBUTING.md](CONTRIBUTING.md).
