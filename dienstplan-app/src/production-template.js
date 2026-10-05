// Gliederung für neue Produktionen. Jede Produktion bekommt diese Unterpunkte als Vorlage;
// alles lässt sich danach umbenennen, ergänzen, umsortieren oder löschen.
// hint: grauer Hinweis, solange der Unterpunkt leer ist. body: vorausgefüllter Inhalt.
export const PHASES = [
  { key: 'ueberblick', label: 'Überblick', icon: '🧭' },
  { key: 'vorbereitung', label: 'Vorbereitung', icon: '🛠️' },
  { key: 'show', label: 'Show', icon: '🎭' },
  { key: 'nachbereitung', label: 'Nachbereitung', icon: '📦' },
];
export const PHASE_KEYS = PHASES.map((p) => p.key);

export const STATUSES = { vorbereitung: 'In Vorbereitung', laeuft: 'Läuft', abgespielt: 'Abgespielt' };

export const TEMPLATE = [
  { phase: 'ueberblick', title: 'Team & Kontakte', hint: 'Regie, Bühne, Kostüm, Licht, Ton, Video, Produktionsleitung, Inspizienz – mit Telefonnummer. Wer aus der Technik ist zuständig?' },
  { phase: 'ueberblick', title: 'Eckdaten', hint: 'Premiere, Vorstellungen, Spielstätte, Dauer, Pause, Einlass, Besonderheiten (Publikum auf der Bühne, Nebel, Pyro …).' },

  { phase: 'vorbereitung', title: 'Bühne & Aufbau', hint: 'Bühnenbild, Bauprobe, Podeste, Züge, Aushänge, Material, Zeitplan für die Einrichtung.' },
  { phase: 'vorbereitung', title: 'Licht', hint: 'Lichtkonzept, Plot, Sonderscheinwerfer, Programmierung, Stimmungen.' },
  { phase: 'vorbereitung', title: 'Ton & Video', hint: 'Mikrofone, Zuspieler, Beschallung, Monitoring, Projektion, Kameras.' },
  { phase: 'vorbereitung', title: 'Requisiten & Effekte', hint: 'Nebel/Haze, Pyro, Wasser, Feuer, Konfetti – mit den nötigen Genehmigungen.' },
  { phase: 'vorbereitung', title: 'Sicherheit', hint: 'Gefährdungsbeurteilung, Anzeigen (Pyro, offenes Feuer), Fluchtwege, Unterweisungen.' },
  { phase: 'vorbereitung', title: 'Material & Bestellungen', hint: 'Was fehlt, was ist bestellt, Leihmaterial (von wem, bis wann). Größere Wünsche auch unter „Bestellen“ eintragen.' },

  { phase: 'show', title: 'Einrichtung & Zeitplan', hint: 'Wer kommt wann, Reihenfolge beim Aufbau, Lichteinrichtung, Soundcheck.' },
  { phase: 'show', title: 'Ablauf & Cues', hint: 'Szenenfolge, Umbauten, Einsätze der Technik – oder der Link zur Cue-Liste.' },
  { phase: 'show', title: 'Checkliste vor der Vorstellung', body: '[ ] Licht-Preset geladen\n[ ] Tontest / Mikros geprüft\n[ ] Nebel/Haze gefüllt\n[ ] Requisiten auf Position\n[ ] Fluchtwege frei, Notbeleuchtung an\n[ ] Funk / Intercom geprüft' },
  { phase: 'show', title: 'Abbau nach der Vorstellung', hint: 'Was muss nach jeder Vorstellung weg, was bleibt stehen, was wird geladen?' },

  { phase: 'nachbereitung', title: 'Abbau & Einlagerung', hint: 'Was steht wo (Lager, Container, Regal), was ging zurück, was wurde entsorgt.' },
  { phase: 'nachbereitung', title: 'Leihmaterial & Rückgaben', hint: 'Was muss bis wann wohin zurück? Abhaken, wenn erledigt.' },
  { phase: 'nachbereitung', title: 'Was lief gut, was nicht', hint: 'Erkenntnisse fürs nächste Mal: Probleme, Lösungen, Ideen.' },
  { phase: 'nachbereitung', title: 'Wiederaufnahme & Gastspiel', hint: 'Alles, was man braucht, um das Stück wieder aufzubauen: Pläne, Einstellungen, Fotos, Showfiles.' },
];

// Vorlagen für datierte Unterpunkte (Notizen aus Treffen, Vorstellungsberichte).
export const DATED = {
  vorbereitung: { label: 'Treffen', button: '＋ Notizen aus Treffen', body: 'Dabei: \n\n## Besprochen\n- \n\n## Zu erledigen\n[ ] ' },
  show: { label: 'Vorstellung', button: '＋ Vorstellungsbericht', body: '## Was war los?\n- \n\n## Kaputt / fehlt\n- \n\n## Bis zur nächsten Vorstellung\n[ ] ' },
};

export const FIRST_PRODUCTIONS = ['Perfection', 'Voguing Ball', 'OMSK'];
