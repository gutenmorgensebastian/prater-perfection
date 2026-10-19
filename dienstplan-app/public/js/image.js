// Fotos vor dem Hochladen verkleinern: höchstens Full HD (1920 × 1080, Hoch- oder Querformat),
// als JPEG mit 85 % Qualität. Spart Speicher und macht das Hochladen auch bei schlechtem Netz schnell.
const MAX_LONG = 1920;
const MAX_SHORT = 1080;
const QUALITY = 0.85;
const SHRINKABLE = /^image\/(jpeg|jpg|png|webp|heic|heif|bmp|tiff)$/i; // GIF (Animation) und SVG bleiben, wie sie sind

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* weiter mit <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Fitting-Faktor: lange Seite ≤ 1920, kurze Seite ≤ 1080, nie vergrößern.
export const fullHdScale = (w, h) => Math.min(1, MAX_LONG / Math.max(w, h), MAX_SHORT / Math.min(w, h));

export async function shrinkImage(file) {
  if (!file || !SHRINKABLE.test(file.type || '')) return file;
  let img;
  try { img = await decode(file); } catch { return file; } // Format, das der Browser nicht lesen kann
  const w = img.width;
  const h = img.height;
  const scale = fullHdScale(w, h);
  // Kleine Bilder in Ordnung lassen (z. B. ein Screenshot mit 300 KB)
  if (scale === 1 && file.size < 1_000_000 && /jpe?g|png|webp/i.test(file.type)) { img.close?.(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // durchsichtige PNGs bekommen weißen Hintergrund
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob || (scale === 1 && blob.size >= file.size)) return file;
  const name = `${(file.name || 'foto').replace(/\.[^.]+$/, '')}.jpg`;
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}
