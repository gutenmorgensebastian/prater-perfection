// pdf.js mit eingebettetem Worker (kein Netzwerk nötig). Der Worker steckt als Text in der HTML-Datei
// (<script type="text/plain" id="pdf-worker">) und wird als Blob gestartet.
import * as lib from 'pdfjs-dist/legacy/build/pdf.mjs';

const el = document.getElementById('pdf-worker');
if (el) lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([el.textContent], { type: 'text/javascript' }));

export const getDocument = lib.getDocument;
export const getPdfjs = async () => lib;
