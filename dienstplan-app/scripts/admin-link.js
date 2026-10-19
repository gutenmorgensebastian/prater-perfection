// Gibt die Einladungslinks aller Admins aus (falls der Link vom ersten Start verloren ging).
import { db, bootstrap } from '../src/db.js';

bootstrap();
const base = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
for (const p of db.prepare("SELECT name, token FROM people WHERE role = 'admin'").all()) {
  console.log(`${p.name}: ${base}/join/${p.token}`);
}
