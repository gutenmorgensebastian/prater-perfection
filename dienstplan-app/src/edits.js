// Bearbeitete eingelesene Termine über eine neue Planfassung retten.
// Regel pro Feld: Hat jemand den Wert geändert und der neue Plan hat ihn NICHT geändert, bleibt die Änderung.
// Hat der Plan selbst etwas geändert (z. B. neue Anfangszeit), gilt der neue Plan. Notizen bleiben immer.
export const PLAN_FIELDS = ['title', 'start', 'end', 'all_day', 'location', 'notes'];

// Welcher neue Termin entspricht dem alten? Dienste: gleiche Person, gleicher Tag.
// Veranstaltungen/Proben: gleicher Tag und gleiche Anfangszeit laut Plan (sonst gleicher Titel).
export function sameSlot(oldEv, newEv) {
  const o = JSON.parse(oldEv.original);
  if (oldEv.kind !== newEv.kind || o.start.slice(0, 10) !== newEv.start.slice(0, 10)) return false;
  if (oldEv.kind === 'shift' || oldEv.kind === 'off') return oldEv.person_id === newEv.person_id;
  return o.start === newEv.start || o.title.toLowerCase() === newEv.title.toLowerCase();
}

// Liefert die Felder für den neuen Termin (mit übernommenen Änderungen) und dessen neues "original".
export function mergeEdit(oldEv, newEv) {
  const o = JSON.parse(oldEv.original);
  const plan = Object.fromEntries(PLAN_FIELDS.map((f) => [f, newEv[f]]));
  const merged = { ...plan };
  let kept = false;
  for (const f of PLAN_FIELDS) {
    const userChanged = oldEv[f] !== o[f];
    if (!userChanged) continue;
    if (f === 'notes' || plan[f] === o[f]) { merged[f] = oldEv[f]; kept = true; }
  }
  // Ende vor Beginn (Plan hat Beginn verschoben, Ende war von Hand verlängert) → Plan-Zeiten nehmen.
  if (merged.end && merged.end < merged.start) { merged.start = plan.start; merged.end = plan.end; }
  return { fields: merged, original: kept ? JSON.stringify(plan) : null };
}
