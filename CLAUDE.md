# Pratomat – Hinweise für Claude

Team-Tool fürs Technik-Team der Volksbühne im Prater (ca. 10 Personen, Handy-Website/PWA). Der Code liegt in `dienstplan-app/`,
Funktionen und Bedienung stehen in `dienstplan-app/README.md`. Sprache der Oberfläche und der Kommentare: Deutsch.
Die übrigen Ordner im Repository (`perfection`, `mvr220922-perfectionsaal`) gehören nicht zum Pratomat.

## Technik
- Node ≥ 22.13, Express 5, `node:sqlite` (Daten in `data/`), keine Build-Stufe für das Frontend (ES-Module in `public/`).
- Start: `cd dienstplan-app && npm install && cp .env.example .env && npm start`. Der Admin-Link steht beim ersten Start im Terminal.
- Tests: `npm test` (`node --test`). Bild-Texterkennung braucht `pdftoppm` und `tesseract` (+ `deu`), sonst wird der Test übersprungen.
- Docker: `Dockerfile`, `docker-compose.yml`, `Caddyfile` (siehe README).
- Der Hauptzweig `main` bekommt den Stand per Pull Request. Entwickelt wurde auf `claude/vibrant-goldberg-la0ll7`.

## Aufbau
- `server.js`: Anmeldung per Link, Kalender, Chat, Admin, Import, Rückgängig. `src/team.js`: To-Dos, Fragen, Infos, Bestellungen. `src/productions.js`: Produktionen (Wiki).
- Import von PDFs: `src/imports.js` (Erkennung der Art, Entwürfe, Veröffentlichen), `src/pdf-text.js`, `src/spielplan.js`, `src/probenplan.js`, `src/pdf-ocr.js` (Bild-Texterkennung), `src/mailin.js` (E-Mail-Eingang).
- Frontend: `public/app.js` (Router, SSE), `public/js/*.js` (je Reiter ein Modul), `public/styles.css`.
- `lite/`: abgespeckte Variante als einzelne HTML-Datei (`npm run build:lite`). `lite/mock.js` ersetzt den Server im Browser und muss bei API-Änderungen nachgezogen werden.

## Entscheidungen, die man kennen sollte
- **Rollen:** Admin, Mitarbeiter*in, Gast (nur lesen), „Ohne Zugang“ (steht nur im Dienstplan). Anmeldung nur per Link, Cookie 400 Tage, pro Person `/manifest.webmanifest` mit `start_url=/join/<token>`, damit iPhone-Kacheln angemeldet bleiben.
- **Nur Prater-Veranstaltungen** kommen als Veranstaltungen in den Kalender (aus Dienstplan und Spielplan), gefiltert in `src/roster.js` (`splitByPlaces`, `venueEntries`). Probenplan-Termine gehen in den Kalender „Proben“.
- **Neue Planfassung ersetzt die alte** (`replacePrevious`). Von Hand bearbeitete Termine behalten ihre Änderungen (`src/edits.js`), außer der Plan ändert genau diesen Wert. Notizen bleiben immer.
- **Rückgängig bei jedem Löschen** (`src/undo.js`): Vor dem Löschen werden die Zeilen gemerkt, auch mitgelöschte. `DELETE` liefert `{ undo }`, `POST /api/undo/:token` holt zurück. Im Frontend `deleteWithUndo()` (10 Sekunden, kein `confirm`). Neue Löschfunktionen müssen dort mit `snapshot()` angebunden werden.
- **Vertrauliche Infos:** nur für ausgewählte Personen sichtbar, auch Anhänge (`canSeeAttachment` in `/api/files/:id`). Nur Admins ändern das. Push dafür ohne Text.
- **Fragen an …** sehen nur Fragende und Gefragte, auch Admins nicht.
- **Konfliktschutz** bei Produktions-Unterpunkten (`base` = `updated_at`, 409), Häkchen werden einzeln per `/toggle` gesetzt.
- Fotos werden im Browser auf Full HD verkleinert (`public/js/image.js`).
- Zeiten sind Ortszeit Berlin als Text (`YYYY-MM-DDTHH:MM`), keine Zeitzonen-Umrechnung.

## Daten und Datenschutz
- Das Repository ist **öffentlich**. Keine echten Dienstpläne, Namen im Klartext, Passwörter oder `.env` einchecken. Tests nutzen erfundene PDFs (`test/helpers/minipdf.js`).
- Laufende Daten liegen in `dienstplan-app/data/` (SQLite + Uploads) und gehören gesichert.

## Offene Ideen
- Server einrichten (Hetzner oder Mac mini), Anleitung als Claude-Doc „Hetzner-Server für den Pratomat“.
- Demo-Seite (Browser-Nachbau mit Beispieldaten) wurde in der Cloud gebaut und liegt nicht im Repository, weil sie echte Plan-Daten enthält.
