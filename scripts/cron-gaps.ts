/**
 * Cuenta las corridas horarias que faltan en los crons de snapshots.
 *
 * Run: `npx tsx scripts/cron-gaps.ts [--hours 30]`
 *
 * `sensor-snapshot` y `energy-snapshot` corren una vez por hora y escriben una
 * fila por dispositivo. Si una hora no tiene ninguna fila, esa corrida falló —
 * los crons no dejan rastro propio en la base, así que los datos que producen
 * son la única evidencia de que corrieron.
 *
 * Contexto (2026-09-14): antes de escalonar los horarios y agregar timeout y
 * reintentos a la lectura de `property_devices`, sensores perdía 9 de 30 horas
 * y energía 2 de 30. Esa es la línea de base contra la que comparar.
 *
 * Lee credenciales service-role de .env.local (bypassea RLS).
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../.env.local") });

const idx = process.argv.indexOf("--hours");
const HOURS = idx > -1 ? Number(process.argv[idx + 1]) : 30;

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function report(label: string, table: string, baseline: string) {
  const since = new Date(Date.now() - HOURS * 3600_000).toISOString();
  const res = await fetch(
    `${BASE}/rest/v1/${table}?select=taken_at&taken_at=gte.${since}&order=taken_at.asc`,
    { headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` } },
  );
  const rows = (await res.json()) as Array<{ taken_at: string }>;
  if (!Array.isArray(rows)) {
    console.error(`${label}: no pude leer ${table}`, rows);
    return;
  }
  const hours = [...new Set(rows.map((r) => r.taken_at.slice(0, 13)))].sort();
  const gaps: string[] = [];
  for (let i = 1; i < hours.length; i++) {
    const prev = new Date(`${hours[i - 1]}:00:00Z`).getTime();
    const cur = new Date(`${hours[i]}:00:00Z`).getTime();
    const missing = (cur - prev) / 3600_000 - 1;
    if (missing > 0) gaps.push(`${hours[i - 1].slice(11)}h→${hours[i].slice(11)}h (${missing})`);
  }
  console.log(`\n${label}`);
  console.log(`  horas con datos: ${hours.length}/${HOURS}   filas: ${rows.length}`);
  console.log(`  línea de base:   ${baseline}`);
  console.log(`  huecos:          ${gaps.length ? gaps.join("  ") : "ninguno"}`);
}

async function main() {
  if (!BASE || !KEY) {
    console.error("faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }
  console.log(`Corridas horarias en las últimas ${HOURS} h`);
  await report("sensor-snapshot", "sensor_snapshots", "21/30 antes del arreglo");
  await report("energy-snapshot", "energy_snapshots", "28/30 antes del arreglo");
}

main().catch((e) => { console.error("\n❌", e); process.exit(1); });
