// pdf.js mit eingebettetem Worker (kein Netzwerk nötig). Der Worker steckt als Text in der HTML-Datei
// (<script type="text/plain" id="pdf-worker">) und wird als Blob gestartet.
import * as lib from 'pdfjs-dist/legacy/build/pdf.mjs';

const el = document.getElementById('pdf-worker');
if (el) lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([el.textContent], { type: 'text/javascript' }));

// Startet der PDF-Worker in einem Browser nicht, würde das Lesen ewig hängen. Dann lieber eine Meldung.
export function getDocument(params) {
  const task = lib.getDocument(params);
  const promise = Promise.race([
    task.promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Das PDF lässt sich in diesem Browser nicht lesen (PDF-Verarbeitung startet nicht). Bitte in Safari oder Chrome öffnen.')), 25_000)),
  ]);
  return { promise, destroy: () => task.destroy() };
}
export const getPdfjs = async () => lib;
