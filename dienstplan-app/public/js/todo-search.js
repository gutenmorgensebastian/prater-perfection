// Suche in To-Dos: jedes Wort muss irgendwo passen (Titel, Notiz, Unteraufgabe, Tag oder Person).
// "#licht" sucht nur in Tags.
export function matchesTodo(todo, query, nameOf) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const tags = todo.tags || [];
  const hay = [todo.title, todo.notes, ...(todo.subtasks || []).map((s) => s.title), ...tags, ...(todo.assignees || []).map(nameOf)]
    .join('\n').toLowerCase();
  return words.every((w) => (w.startsWith('#') ? tags.some((t) => t.startsWith(w.slice(1))) : hay.includes(w)));
}
