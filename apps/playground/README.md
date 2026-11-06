# playground

Web-Editor für answerfield: links der Quelltext (CodeMirror) mit Syntaxfarben, Fehlern, Vervollständigung und Hover, rechts
Vorschau und Design aus `@answerfield/studio-ui`, wie im VS-Code-Plugin. Alles läuft im Browser, ohne Server.

```sh
npm start -w @answerfield/playground   # bauen, bei Änderungen neu bauen, http://localhost:8100
npm run build -w @answerfield/playground   # Produktions-Build nach dist/ (statisch, z. B. für die Website)
```

Voraussetzung: Abhängigkeiten installiert und die Pakete gebaut (`npm ci` und `npm run build` im Root).

## Aufbau

```
Seite (main.ts)                           Web Worker (worker.ts)
  CodeMirror ── Text, Version ──────────▶   @answerfield/language im Speicher (EmptyFileSystem)
             ◀─ Fehler, Dev-Bundle ──────   @answerfield/compiler: compileForEditor
             ── complete / hover ───────▶   Langium CompletionProvider, HoverProvider
  iframe studio.html (@answerfield/studio-ui)
             ◀─ bundle, reply ──────────    describe / palette / edit: wie der Language Server im Plugin
             ── select, describe, edit ─▶
```

- `src/protocol.ts`: Nachrichten zwischen Seite und Worker; zum Studio gilt `@answerfield/studio-ui/protocol`.
- `src/highlight.ts`: Syntaxfarben; die Schlüsselwörter kommen aus der TextMate-Grammatik in `@answerfield/language`.
- `build.mjs`: bündelt Seite, Worker und Studio mit esbuild und legt die Beispiele ab (Texte in `examples.json`,
  Medien daneben).

## Beispiele

Nur eigene Aufgaben aus `examples/` (Liste in `build.mjs`): die einzelnen Aufgaben in `basic/`, das Testheft
`basic/fractions/` und die Lernreihe `learning/fractions/`. Alle Dateien sind zugleich geladen, damit Komponenten und
Testhefte ihre Bezüge finden.
