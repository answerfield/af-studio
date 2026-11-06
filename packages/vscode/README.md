# answerfield für VS Code

Sprachunterstützung für `.af`-Dateien: Hervorhebung, Fehler und Typprüfung, Vervollständigung,
Hover mit Signaturen und Typen, Gehe zu Definition (auch in die eingebauten Bibliotheken),
Formatierung und Schnellkorrekturen.

Befehl **answerfield: Bibliothek öffnen** zeigt Prelude und `std`.

## Vorschau und Design

**answerfield: Vorschau und Design öffnen** (⌘K V bzw. Strg+K V, Symbol in der Editor-Titelleiste, oder „Öffnen mit… → answerfield-Editor“)
öffnet einen Editor-Tab für die Datei, gerendert mit derselben Runtime wie in der Testung.

- **Vorschau:** bedienen; Antworten, Codes, Missing-Codes und Scores live; Bedarfsprofil umschalten
- **Design:** auswählen (Klick, Tab, Pfeiltasten), Eigenschaften im Formular ändern, entfernen;
  jede Änderung ist eine Textänderung (Undo, Speichern, Git wie beim Tippen)
- Auswahl und Cursor im Text folgen einander; Alt+Klick in der Vorschau zeigt die Quelle
- Zustand bleibt beim Bearbeiten erhalten; bei Syntaxfehlern bleibt der letzte gültige Stand stehen
- Struktur: Ansicht **answerfield-Struktur** im Explorer, für Text und answerfield-Editor (die eingebaute Gliederung funktioniert nur im Texteditor);
  im Design zusätzlich ein anklickbarer Pfad zur Auswahl

## Tests

`npm run test:integration` startet eine echte VS-Code-Instanz (lokal installiert, sonst `VSCODE_PATH` setzen),
öffnet `fraction1.af` im answerfield-Editor und prüft die Ansicht „answerfield-Struktur“.
