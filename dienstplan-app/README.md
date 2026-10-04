# Dienstplan-App (Kalender · Chat · To-Dos · Fragen · Infos · Bestellen)

Eine Website fürs Technik-Team, die sich wie eine App aufs Handy legen lässt (Android und iPhone).

- **Gemeinsamer Kalender.** Wer einen Einladungslink bekommt, sieht den Kalender sofort, ohne Passwort und ohne App-Store.
- **Abo im Handykalender.** Der Kalender lässt sich in Google Kalender, Apple Kalender oder Outlook abonnieren. Jede Person wählt selbst, wessen Dienste dort erscheinen.
- **Dienstplan-Import.** PDF hochladen, die Vorschau prüfen und veröffentlichen. Dann stehen alle Dienste automatisch im Kalender, jeweils der Person zugeordnet.
  - Im Kalender lässt sich jede Person einzeln ein- und ausblenden (farbige Chips), dazu Prater-Veranstaltungen und Frei-Tage.
  - Kommt eine geänderte Fassung derselben Woche, lädst du sie einfach neu hoch. Die alte wird ersetzt.
- **Chat.**
  - Mehrere Gruppen, jede ist ein eigener Tab.
  - PDFs, Bilder und Links lassen sich anhängen.
  - Pro Gruppe gibt es eine **Ablage** mit allen Dateien, Links und angepinnten Nachrichten.
- **Spielplan-Import.** Der Monats-Spielplan der Volksbühne (PDF) wird eingelesen. Alle Prater-Veranstaltungen landen im Kalender, inklusive Prater-Foyer, TE, EP und Bauproben.
- **To-Dos.**
  - Aufgaben mit Unteraufgaben, einer oder mehreren zuständigen Personen und Tags.
  - Fotos und Dateien lassen sich anhängen.
  - 🚩 rotes Fähnchen für wirklich Wichtiges.
  - Reihenfolge per Ziehen am ⠿-Griff.
  - Filter „Nur meine“ und „Meine zuerst“.
  - Suche nach Wort, Person oder `#tag`.
  - Bewusst ohne Termine, Erinnerungen und Prioritätsstufen.
- **Fragen an …:** Jede Frage geht an eine Person. Sie sehen nur die beiden Beteiligten, auch Admins sehen fremde Fragen nicht. Zwei Ansichten: „An mich“ und „Von mir gestellt“. Mit Antworten, „Erledigt“ und einer Zahl am Reiter, wenn etwas auf dich wartet.
- **Infos:**
  - Sicherheitsbestimmungen, Anleitungen (z. B. Alarmanlage), wichtige PDFs und Ansagen, sortiert nach Rubriken.
  - Bei einer **Ansage** bekommen alle eine Benachrichtigung.
- **Bestellen:**
  - Bestellwünsche mit Menge, Notiz bzw. Shop-Link und Fotos.
  - Mit „🙋 Ich kümmere mich“ übernimmt jemand den Wunsch, danach folgen „Bestellt“ und „Erledigt / ist da“.
- **Benachrichtigungen** bei neuen Nachrichten, neuen Dienstplänen, To-Dos für dich, Fragen und Antworten an dich und Ansagen. Auf dem iPhone geht das nur, wenn die Seite zum Home-Bildschirm hinzugefügt wurde.

## Dienstplan-Erkennung

Es gibt zwei Wege, das PDF einzulesen. Vor dem Veröffentlichen kommt bei beiden eine Vorschau, in der du jede Zelle korrigieren kannst.

| Weg | Kosten | Wann |
|---|---|---|
| **Textebene des PDFs** | kostenlos | Funktioniert, wenn der Scanner Texterkennung macht. Beim aktuellen Plan (Sharp-Kopierer) ist das so, und typische Lesefehler wie `18:C)0` werden automatisch korrigiert. |
| **KI (Claude)** | ca. 1–5 Cent pro PDF | Funktioniert auch bei reinen Bild-Scans oder Fotos. Liest zuverlässiger. Dafür muss `ANTHROPIC_API_KEY` gesetzt sein. |

Codes wie `F`, `F 40.2` oder `FÜ` werden als **Frei** eingetragen. Frei-Tage sind standardmäßig ausgeblendet und lassen sich einblenden.

Von den Bereichszeilen (Bühne, 3. Stock, Roter und Grüner Salon …) kommen **nur Prater-Veranstaltungen** in den Kalender. Das sind:
- eine Zeile namens „Prater“,
- Einträge, die mit `PRATER` beginnen,
- Zeilen, die du in der Vorschau per Häkchen als Prater markierst.

## Spielplan-Erkennung

Der Monats-Spielplan („Aktualisierter Spielplan November 2026“) kommt als PDF aus Word und hat echten Text. Er wird deshalb kostenlos und zuverlässig gelesen.
- Übernommen werden alle Einträge mit `PRATER` oder `PRATER-FOYER`. Die meisten stehen in der Spalte „3.Stock & Prater“.
- In der Vorschau kannst du einzelne Einträge abwählen oder korrigieren.
- Ein aktualisierter Spielplan desselben Monats ersetzt den alten.
- Steht eine Veranstaltung schon aus dem Dienstplan im Kalender (gleiche Anfangszeit), wird sie nicht doppelt eingetragen.

## Warum nicht OneDrive, Google Drive oder pCloud?

Das sind reine Dateispeicher. Für Chat, Anmeldung per Link, Benachrichtigungen und ein Kalender-Abo, das sich selbst aktualisiert, braucht es einen kleinen Server. Diese App ist dieser Server.

Alles liegt in **einer** Datenbank-Datei und einem Ordner mit Uploads. Das Backup ist also einfach.

## Hosting (Empfehlung)

**Ein kleiner Server bei [Hetzner](https://www.hetzner.com/cloud)** (Rechenzentrum in Deutschland, ab ca. 4–6 € im Monat) reicht für 10 Personen locker. Alternativ geht jeder andere Server mit Docker, z. B. netcup oder IONOS.

Du brauchst außerdem eine **Domain oder Subdomain**, etwa `dienstplan.deinname.de`, denn HTTPS ist für Benachrichtigungen und Kalender-Abos Pflicht. Kostenlos geht es z. B. mit [DuckDNS](https://www.duckdns.org).

### Einrichtung Schritt für Schritt
1. Bei Hetzner einen Cloud-Server anlegen (Ubuntu, kleinste Größe, Standort Nürnberg oder Falkenstein). Unter „Apps“ **Docker CE** auswählen.
2. Beim Domain-Anbieter einen **A-Eintrag** für deine (Sub-)Domain auf die IP-Adresse des Servers setzen.
3. Auf dem Server (per SSH):
   ```bash
   git clone <dieses-repo> && cd prater-perfection/dienstplan-app
   cp .env.example .env && nano .env      # Domain, Name, E-Mail eintragen
   docker compose up -d
   docker compose logs app                 # zeigt deinen Admin-Link
   ```
4. Den **Admin-Link** auf dem Handy öffnen. Fertig, du bist angemeldet.

Den Admin-Link kannst du später jederzeit wieder anzeigen: `docker compose exec app npm run admin-link`.

**Backup:** Den Ordner `data/` sichern, er enthält Datenbank und Uploads.

**Update:**
```bash
git pull && docker compose up -d --build
```

## Erste Schritte in der App
1. **Mehr → Verwaltung → Dienstplan einlesen:** PDF hochladen, Vorschau prüfen, dann auf „Veröffentlichen“.
   - Neue Namen aus dem Plan werden automatisch als Personen angelegt, zunächst „Ohne Zugang“.
2. **Mehr → Verwaltung → Personen:** Bei jeder Person die Rolle setzen. Dann erscheint ein Einladungslink.
   - 🔗 kopiert den Link, 📲 schickt ihn per WhatsApp.
   - Mit ♻️ wird ein Link ungültig gemacht und durch einen neuen ersetzt, z. B. wenn er in falsche Hände geraten ist.
3. **Kalender → ⚙︎ Kalender verwalten** (nur Admins): eigene Kalender wie „Proben“ oder „Urlaub“ anlegen. Termine eintragen können danach alle Mitarbeiter*innen.

**Rollen:**

| Rolle | Darf |
|---|---|
| Admin | alles, inklusive Verwaltung und Kalender anlegen |
| Mitarbeiter*in | alles lesen und schreiben: Termine, Chat, To-Dos, Fragen, Infos, Bestellwünsche |
| Gast | alles lesen, nichts schreiben |
| Ohne Zugang | steht nur im Dienstplan, kein Link |

## Anmeldung: nur ein Link
- Jede Person bekommt **ihren eigenen Link**. Einmal antippen, dann ist sie angemeldet. Es gibt kein Passwort und keine E-Mail-Bestätigung.
- Beim ersten Öffnen erscheint eine kurze Anleitung, wie man die Seite als **Kachel auf den Home-Bildschirm** legt. Ab dann startet man über die Kachel.
- **Man bleibt angemeldet.** Die Anmeldung gilt 400 Tage und verlängert sich bei jeder Nutzung. Wer die Kachel regelmäßig nutzt, muss sich also nie neu anmelden.
- **iPhone:** Eine Kachel auf dem Home-Bildschirm hat dort eigene Cookies, getrennt von Safari. Die Kachel startet deshalb immer über den persönlichen Link. Damit das klappt:
  - Das App-Manifest wird pro Person ausgeliefert.
  - Der Einladungslink bleibt in der Adresszeile stehen.
  - Sollte eine Kachel trotzdem einmal nicht angemeldet sein, kann man den Link direkt in der App einfügen.
- Der Link ist wie ein Schlüssel: Wer ihn hat, kommt rein. Ist er in falsche Hände geraten, erzeugst du in der Verwaltung mit ♻️ einen neuen. Der alte geht dann nicht mehr.

## Kalender-Abo: gut zu wissen
- Das Abo ist eine Einbahnstraße: Änderungen macht man in der App, der Handykalender zeigt sie an.
- **Apple** aktualisiert meist stündlich. **Google** aktualisiert seltener, oft erst nach einigen Stunden. Wer es sofort braucht, schaut in die App.
- Bei Google fügt man das Abo am einfachsten über die Google-Kalender-Webseite hinzu. Danach erscheint es auch in der Android-App.

## Datenschutz
- Alle Daten bleiben auf deinem Server. Es werden keine externen Dienste oder CDNs eingebunden.
- Wenn die KI-Erkennung eingeschaltet ist, wird nur das hochgeladene Dienstplan-PDF zur Auswertung an Anthropic (Claude-API) geschickt. Ohne API-Schlüssel passiert das nie.
- Einladungs- und Kalenderlinks sind wie Passwörter. Bitte nicht in große Gruppen posten.

## Lokal ausprobieren (für Entwickler)
```bash
npm install
npm run dev        # http://localhost:3000 – Admin-Link steht in der Konsole
npm test
```
Voraussetzung ist Node.js ≥ 22.13 (nutzt das eingebaute `node:sqlite`).

| Ordner/Datei | Inhalt |
|---|---|
| `server.js` | API, Anmeldung, Kalender-Feed |
| `src/roster.js` | Zellen → Kalendereinträge, Prater-Filter |
| `src/spielplan.js` | Spielplan-PDF → Prater-Veranstaltungen |
| `src/team.js` | To-Dos, Fragen, Infos, Bestellwünsche |
| `src/pdf-text.js` | Erkennung über die Textebene |
| `src/pdf-claude.js` | KI-Erkennung |
| `src/ics.js` | Kalender-Abo |
| `src/notify.js` | Live-Updates und Push |
| `public/` | Oberfläche (ohne Build-Schritt) |
