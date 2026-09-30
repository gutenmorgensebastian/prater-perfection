# TheaterMIB – grandMA3 Plugin

Geht die Cueliste des Stücks durch und findet bei jedem Szenenwechsel die
Movingheads, die in der aktuellen Szene dunkel sind (Dimmer 0) und in der
nächsten Szene benutzt werden. Pro Szenenwechsel werden diese Geräte selektiert
(im Layout / Fixture Sheet sichtbar) und es wird gefragt, in welcher Zeit sie
auf Position / Shaper / Beam / Color der nächsten Szene fahren sollen.

Die Werte der nächsten Szene – alles außer Dimmer (und Control) – werden mit
dieser Zeit als **individuelles Fade/Delay in die Quell-Cue** gespeichert
(`Store … /Merge`). Die Mover fahren also schon mit dem GO der aktuellen Szene
im Dunkeln los und sind nach Delay + Fade fertig – egal, wann das nächste GO
kommt.

Geräte, die in der Quell-Cue selbst erst ausgeblendet werden, sind im Dialog
mit `*` markiert. Dort das Delay mindestens so lang wie das Ausfaden setzen,
sonst sieht man die Bewegung.

## Installation

1. Ordner `TheaterMIB` (mit `.xml` und `.lua`) auf einen USB-Stick nach
   `grandMA3/gma3_library/datapools/plugins/` kopieren.
2. Im Plugin-Pool: Edit auf einen leeren Platz → **Import** → `TheaterMIB`.

## Benutzung

1. Die Cueliste des Stücks selektieren (Sequenz selektieren).
2. Eine Gruppe mit allen Movingheads anlegen, Standardname `MH`
   (oder `Call Plugin "TheaterMIB" "Gruppenname"`).
3. Plugin starten, Gruppe und Bereich (ganze Sequenz / ab aktueller Cue) wählen.
4. Für jeden gefundenen Szenenwechsel: Fade und Delay eingeben,
   **Speichern**, **Überspringen** oder **Abbrechen**. Mit „Für alle weiteren
   Wechsel übernehmen“ werden die restlichen ohne Nachfrage gesetzt.

Alle Änderungen liegen in einem Undo-Schritt (`Oops`).

## Hinweise

- Der Programmer wird geleert. Lesen (`Group … At Cue …`) und Speichern
  passieren im **Blind** – live wird nichts ausgegeben.
- Bleibt nach `Off Attribute "Dimmer"` noch ein Dimmerwert im Programmer,
  wird für diesen Wechsel nichts gespeichert (Fehlermeldung in der
  Kommandozeile), damit die Mover in der Quell-Cue nicht aufleuchten.
- Das Plugin ist nicht an einer Konsole getestet. Bitte zuerst an einer
  Kopie der Show in grandMA3 onPC ausprobieren und im Sequence Sheet
  (Spalten Indiv Fade / Indiv Delay) bzw. im Tracking Sheet kontrollieren.
