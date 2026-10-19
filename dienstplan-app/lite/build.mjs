// Baut „Pratomat Lite“: eine einzelne HTML-Datei (lite/dist/pratomat-lite.html), die ohne Server
// und ohne Internet läuft. Aufruf: npm run build:lite
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const shim = path.join(ROOT, 'lite/pdfjs-shim.js');
const realPdfjs = path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.min.mjs');

const plugin = {
  name: 'lite',
  setup(b) {
    b.onResolve({ filter: /^\/shared\/roster\.js$/ }, () => ({ path: path.join(ROOT, 'src/roster.js') }));
    b.onResolve({ filter: /^\/shared\/production-template\.js$/ }, () => ({ path: path.join(ROOT, 'src/production-template.js') }));
    // pdf.js: überall die Hülle mit eingebettetem Worker; nur die Hülle selbst bekommt die echte Bibliothek.
    b.onResolve({ filter: /^pdfjs-dist\// }, (args) => ({ path: args.importer === shim ? realPdfjs : shim }));
    // Node-Teile von pdf.js werden im Browser nie ausgeführt.
    b.onResolve({ filter: /^(node:.*|canvas|fs|path|url|http|https|zlib|module)$/ }, () => ({ external: true }));
  },
};
const out = await esbuild.build({
  entryPoints: [path.join(ROOT, 'lite/entry.js')], bundle: true, format: 'esm', minify: true, write: false,
  plugins: [plugin], target: 'es2022', logLevel: 'warning',
});
const bundle = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let css = read('public/styles.css');
css += `
/* Lite: ohne Chat und Fragen, ohne Server-Funktionen */
#tabbar a[data-tab="chat"], #tabbar a[data-tab="fragen"] { display: none; }
.row:has(#g-announce), .row:has(#sp-announce) { display: none; }
.file-view { max-height: 65vh; overflow: auto; display: grid; gap: .5rem; }
.file-view canvas, .file-view img { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
`;
const html = read('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*><\/script>/g, '');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const lib = (p) => esc(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1f2937">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Pratomat">
<title>Pratomat Lite</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script>${lib('node_modules/fullcalendar/index.global.min.js')}</script>
<script>${lib('node_modules/@fullcalendar/core/locales/de.global.min.js')}</script>
<script>${lib('node_modules/sortablejs/Sortable.min.js')}</script>
<script type="text/plain" id="pdf-worker">${lib('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')}</script>
<script type="module">
${bundle}
</script>
</body>
</html>
`;
fs.mkdirSync(path.join(ROOT, 'lite/dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'lite/dist/pratomat-lite.html'), page);
console.log(`lite/dist/pratomat-lite.html  ${(page.length / 1048576).toFixed(2)} MB`);
