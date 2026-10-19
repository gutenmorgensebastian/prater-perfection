import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEdit, sameSlot } from '../src/edits.js';

const plan = { title: 'Dienst', start: '2026-10-19T09:00', end: '2026-10-19T16:00', all_day: 0, location: '', notes: '' };
const edited = (changes) => ({ kind: 'shift', person_id: 2, ...plan, ...changes, original: JSON.stringify(plan) });
const fresh = (changes) => ({ kind: 'shift', person_id: 2, ...plan, ...changes });

test('Änderung bleibt, wenn die neue Planfassung den Wert nicht ändert', () => {
  const r = mergeEdit(edited({ end: '2026-10-19T18:30', notes: 'Abbau dauerte länger' }), fresh({}));
  assert.equal(r.fields.end, '2026-10-19T18:30');
  assert.equal(r.fields.notes, 'Abbau dauerte länger');
  assert.equal(JSON.parse(r.original).end, '2026-10-19T16:00');
});

test('Neuer Plan gewinnt beim geänderten Wert, Notiz bleibt', () => {
  const r = mergeEdit(edited({ end: '2026-10-19T18:30', notes: 'Schlüssel holen' }), fresh({ start: '2026-10-19T14:00', end: '2026-10-19T23:00' }));
  assert.equal(r.fields.start, '2026-10-19T14:00');
  assert.equal(r.fields.end, '2026-10-19T23:00');
  assert.equal(r.fields.notes, 'Schlüssel holen');
});

test('Ohne echte Änderung nichts übernehmen', () => {
  assert.equal(mergeEdit(edited({}), fresh({})).original, null);
});

test('Passenden neuen Termin finden', () => {
  const old = edited({ end: '2026-10-19T18:30' });
  assert.ok(sameSlot(old, fresh({})));
  assert.ok(!sameSlot(old, fresh({ person_id: 3 })));
  assert.ok(!sameSlot(old, fresh({ start: '2026-10-20T09:00' })));
  const venuePlan = { title: 'VS VB01 HOH', start: '2026-10-23T20:30', end: null, all_day: 0, location: 'Prater', notes: '' };
  const venue = { kind: 'venue', person_id: null, ...venuePlan, notes: 'Nebel!', original: JSON.stringify(venuePlan) };
  assert.ok(sameSlot(venue, { kind: 'venue', person_id: null, ...venuePlan, start: '2026-10-23T20:30' }));
  assert.ok(sameSlot(venue, { kind: 'venue', person_id: null, ...venuePlan, start: '2026-10-23T19:30' }), 'gleicher Titel, neue Uhrzeit');
});
