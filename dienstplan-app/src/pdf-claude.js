// Liest den Dienstplan mit Claude (KI) aus dem PDF. Funktioniert auch bei reinen Bild-Scans
// und korrigiert Erkennungsfehler zuverlässiger als die Textebene. Braucht ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { sanitizeGrid } from './roster.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

const GRID_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'dates', 'rows'],
  properties: {
    title: { type: 'string' },
    dates: { type: 'array', items: { type: 'string' } },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'kind', 'cells'],
        properties: {
          label: { type: 'string' },
          kind: { type: 'string', enum: ['area', 'person'] },
          cells: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const PROMPT = `This PDF is a weekly staff roster ("Dienstplan") from a German theatre, often a scan.
Transcribe its table into JSON.

- "title": the heading line, e.g. "Dienstplan Technik Prater 41. KW 2026".
- "dates": the 7 column dates, Monday to Sunday, as YYYY-MM-DD.
- "rows": one entry per table row, top to bottom.
  - "label": the row label in the first column (a venue/area like "Bühne" or a person's name).
  - "kind": "area" for venue/area rows that list performances, "person" for rows of a staff member.
  - "cells": exactly 7 strings, Monday to Sunday. Use "" for empty cells.
    Person cells hold shift times like "10:00-18:00" or codes like "F", "F 40.2", "FÜ" - copy codes as printed.
    Area cells hold events such as "19:30 VS VB01 HOH" or "16:00-18:15 VS A YEAR W/O SUMMER";
    join multi-line cell text with spaces and start every event in a cell with its time.
Fix obvious scan errors (e.g. "18:C)0" is "18:00", "i6:ü0" is "16:00", "SuMMER" is "SUMMER") but do not invent content.
Ignore stamps, signatures and handwriting outside the table.`;

export const claudeAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function parseRosterPdfClaude(buffer) {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Falls die Anfrage abgelehnt wird, versucht die API automatisch ein passendes anderes Modell.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: GRID_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(buffer).toString('base64') } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Die KI hat die Anfrage abgelehnt.');
  if (response.stop_reason === 'max_tokens') throw new Error('Die KI-Antwort war zu lang und wurde abgeschnitten.');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Die KI hat keine Tabelle geliefert.');
  return { grid: sanitizeGrid(JSON.parse(text)), warnings: [] };
}
