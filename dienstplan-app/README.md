# Dienstplan-App (Kalender · Dienstplan · Chat)

Eine Website fürs Technik-Team, die sich wie eine App aufs Handy legen lässt (Android und iPhone).

- **Gemeinsamer Kalender.** Wer einen Einladungslink bekommt, sieht den Kalender sofort, ohne Passwort und ohne App-Store.
- **Abo im Handykalender.** Der Kalender lässt sich in Google Kalender, Apple Kalender oder Outlook abonnieren. Jede Person wählt selbst, wessen Dienste dort erscheinen.
- **Dienstplan-Import.** PDF hochladen, die Vorschau prüfen und veröffentlichen. Dann stehen alle Dienste automatisch im Kalender, jeweils der Person zugeordnet.
  - Im Kalender lässt sich jede Person einzeln ein- und ausblenden (farbige Chips), dazu Veranstaltungen und Frei-Tage.
  - Kommt eine geänderte Fassung derselben Woche, lädst du sie einfach neu hoch. Die alte wird ersetzt.
- **Chat.**
  - Mehrere Gruppen, jede ist ein eigener Tab.
  - PDFs, Bilder und Links lassen sich anhängen.
  - Pro Gruppe gibt es eine **Ablage** mit allen Dateien, Links und angepinnten Nachrichten.
- **Benachrichtigungen** bei neuen Nachrichten und neuen Dienstplänen. Auf dem iPhone geht das nur, wenn die Seite zum Home-Bildschirm hinzugefügt wurde.

## Dienstplan-Erkennung

Es gibt zwei Wege, das PDF einzulesen. Vor dem Veröffentlichen kommt bei beiden eine Vorschau, in der du jede Zelle korrigieren kannst.

| Weg | Kosten | Wann |
|---|---|---|
| **Textebene des PDFs** | kostenlos | Funktioniert, wenn der Scanner Texterkennung macht. Beim aktuellen Plan (Sharp-Kopierer) ist das so, und typische Lesefehler wie `18:C)0` werden automatisch korrigiert. |
| **KI (Claude)** | ca. 1–5 Cent pro PDF | Funktioniert auch bei reinen Bild-Scans oder Fotos. Liest zuverlässiger. Dafür muss `ANTHROPIC_API_KEY` gesetzt sein. |

Codes wie `F`, `F 40.2` oder `FÜ` werden als **Frei** eingetragen. Frei-Tage sind standardmäßig ausgeblendet und lassen sich einblenden. Zeilen wie „Bühne“ oder „Roter Salon“ werden zu **Veranstaltungen**.

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
1. **Verwaltung → Dienstplan einlesen:** PDF hochladen, Vorschau prüfen, dann auf „Veröffentlichen“.
   - Neue Namen aus dem Plan werden automatisch als Personen angelegt, zunächst als „Nur Dienstplan“, also ohne Zugang.
2. **Verwaltung → Personen:** Bei jeder Person die Rolle auf „Mitglied“ stellen. Dann erscheint ein Einladungslink.
   - 🔗 kopiert den Link, 📲 schickt ihn per WhatsApp.
   - Mit ♻️ wird ein Link ungültig gemacht und durch einen neuen ersetzt, z. B. wenn er in falsche Hände geraten ist.
3. Jede Person öffnet ihren Link und kann dann:
   - unter **Mehr → Als App installieren** die Seite auf den Home-Bildschirm legen,
   - unter **Mehr → Im Handykalender anzeigen** den Kalender abonnieren,
   - unter **Mehr → Benachrichtigungen** die Benachrichtigungen einschalten.

**Rollen:**

| Rolle | Darf |
|---|---|
| Admin | alles |
| Mitglied | Chat und eigene Termine |
| Nur lesen | sieht alles, kann aber nichts schreiben |
| Nur Dienstplan | kein Zugang, steht nur im Plan |

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
| `src/roster.js` | Zellen → Kalendereinträge |
| `src/pdf-text.js` | Erkennung über die Textebene |
| `src/pdf-claude.js` | KI-Erkennung |
| `src/ics.js` | Kalender-Abo |
| `src/notify.js` | Live-Updates und Push |
| `public/` | Oberfläche (ohne Build-Schritt) |
