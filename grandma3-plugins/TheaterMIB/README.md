# TheaterMIB – grandMA3 Plugin

Geht die Cueliste des Stücks durch und findet bei jedem Szenenwechsel die
Movingheads, die in der aktuellen Szene dunkel sind (Dimmer 0) und in der
nächsten Szene benutzt werden. Pro Szenenwechsel werden diese Geräte selektiert
(im Layout / Fixture Sheet sichtbar) und es wird gefragt, in welcher Zeit sie
auf Position / Shaper / Beam / Color der nächsten Szene fahren sollen.

Die Antwort wird als **Move In Black** in Part 0 der nächsten Cue eingetragen
(`MIB` = Early/Late, `MIBFade`, `MIBDelay`). Das Vorpositionieren im Dunkeln
macht danach die Konsole selbst.

## Installation

1. Ordner `TheaterMIB` (mit `.xml` und `.lua`) auf einen USB-Stick nach
   `grandMA3/gma3_library/datapools/plugins/` kopieren.
2. Im Plugin-Pool: Edit auf einen leeren Platz → **Import** → `TheaterMIB`.

## Benutzung

1. Die Cueliste des Stücks selektieren (Sequenz selektieren).
2. Eine Gruppe mit allen Movingheads anlegen, Standardname `MH`
   (oder `Call Plugin "TheaterMIB" "Gruppenname"`).
3. Plugin starten, Gruppe und Bereich (ganze Sequenz / ab aktueller Cue) wählen.
4. Für jeden gefundenen Szenenwechsel: Fade, Delay und MIB-Modus eingeben,
   **Setzen**, **Überspringen** oder **Abbrechen**. Mit „Für alle weiteren
   Wechsel übernehmen“ werden die restlichen ohne Nachfrage gesetzt.

Alle Änderungen liegen in einem Undo-Schritt (`Oops`).

## Hinweise

- Der Programmer wird geleert. Die Cues werden mit `Group … At Cue …` im
  **Blind** in den Programmer geholt und der Dimmer ausgelesen – live wird
  nichts ausgegeben.
- Welche Attribute beim MIB mitfahren (Position, Shaper, Beam, Color …), regelt
  die MIB-Einstellung der Attribute bzw. der Show; das Plugin setzt nur die Zeit.
- Das Plugin ist nicht an einer Konsole getestet. Bitte zuerst an einer
  Kopie der Show in grandMA3 onPC ausprobieren und im Sequence Sheet
  (Spalten MIB / MIB Fade / MIB Delay) kontrollieren.
