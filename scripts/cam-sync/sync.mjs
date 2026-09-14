// tero-cam-sync: pull a fresh JPEG snapshot for each camera from Home Assistant
// and upload it to the tero.bot Supabase 'camera-snapshots' bucket, updating
// property_cameras.snapshot_url + last_snapshot_at. Runs on a schedule (launchd).
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const HA_URL = process.env.HA_URL || "http://127.0.0.1:8123";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Raíz del repo: dos niveles arriba de scripts/cam-sync/. Antes era una ruta
// absoluta hardcodeada, que ataba el script a una máquina concreta.
const TERO = resolve(__dirname, "..", "..");
const require = createRequire(resolve(TERO, "package.json"));
const dotenv = require("dotenv");
const { Client } = require("pg");

// Un solo archivo de entorno: el .env.local del repo (gitignoreado), que ya
// trae las credenciales de Supabase y ahora también HA_URL / HA_TOKEN.
dotenv.config({ path: resolve(TERO, ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.DATABASE_URL;
// Use the existing HA-issued long-lived access token.
const HA_TOKEN = process.env.HA_TOKEN;
const BUCKET = "camera-snapshots";

for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_KEY, DB_URL, HA_TOKEN })) {
  if (!v) { console.error("missing env", k); process.exit(1); }
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function imageState(entity, onState = () => {}) {
  const state = await haState(entity);
  onState();
  // Event thumbnails can be replayed hours later; HA timestamps receipt, not capture.
  if (state.attributes.image_source !== "live") {
    throw new Error("event thumbnail has no verified capture time; preserving last snapshot");
  }
  const timestamp = Number(state.attributes.image_updated_at);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp * 1000 > Date.now() + 60000) {
    throw new Error("image timestamp unavailable; refusing to mark a cached image as fresh");
  }
  return { at: new Date(timestamp * 1000).toISOString(), generation: state.attributes.image_generation };
}

async function haState(entity) {
  const res = await fetch(`${HA_URL}/api/states/${entity}`, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HA state ${res.status}`);
  return res.json();
}

async function reloadCamera(entity) {
  const res = await fetch(`${HA_URL}/api/services/homeassistant/reload_config_entry`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ entity_id: entity }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HA reload ${res.status}`);
}

async function waitForImageUpdate(entity, previousUpdatedAt, onState) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const state = await haState(entity);
    onState();
    if (state.attributes.image_updated_at !== previousUpdatedAt) return true;
  }
  return false;
}

async function snapshot(entity) {
  const res = await fetch(`${HA_URL}/api/camera_proxy/${entity}`, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`HA ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`tiny image (${buf.length}b)`);
  return buf;
}

async function upload(path, buf) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
      "cache-control": "max-age=60",
    },
    body: buf,
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const db = new Client({ connectionString: DB_URL });
await db.connect();
const { rows } = await db.query(
  "select id, name, ha_entity_id, snapshot_url, last_snapshot_at, last_synced_at, to_jsonb(property_cameras)->>'capture_requested_at' as capture_requested_at from public.property_cameras where ha_entity_id is not null and is_active order by name",
);
let ok = 0;
for (const cam of rows) {
  // Un pedido no nulo es pendiente, punto. NO compararlo contra last_synced_at:
  // ese campo avanza en cada ciclo por motivos ajenos al pedido, así que la
  // comparación invalidaba en silencio cualquier pedido que no se consumiera
  // en el ciclo inmediato, dejándolo huérfano para siempre.
  const capturePending = Boolean(cam.capture_requested_at);
  let reachedCamera = false;
  try {
    if (capturePending) {
      const previousState = await haState(cam.ha_entity_id);
      reachedCamera = true;
      await reloadCamera(cam.ha_entity_id);
      const advanced = await waitForImageUpdate(
        cam.ha_entity_id,
        previousState.attributes.image_updated_at,
        () => { reachedCamera = true; },
      );
      if (!advanced) throw new Error("reload did not produce a new image within 30s");
    }
    // Bind the JPEG to stable source metadata, never to the upload time.
    const before = await imageState(cam.ha_entity_id, () => { reachedCamera = true; });
    const buf = await snapshot(cam.ha_entity_id);
    const after = await imageState(cam.ha_entity_id, () => { reachedCamera = true; });
    if (before.at !== after.at || before.generation !== after.generation) {
      throw new Error("image changed during fetch; retry next cycle");
    }
    // Identical bytes are not a new capture, even if HA was reloaded.
    if (cam.snapshot_url && cam.last_snapshot_at) {
      const previous = new URL(cam.snapshot_url);
      if (previous.origin !== new URL(SUPABASE_URL).origin) throw new Error("unexpected snapshot origin");
      previous.searchParams.set("v", new Date(cam.last_snapshot_at).toISOString());
      const old = await fetch(previous, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!old.ok) throw new Error(`previous snapshot ${old.status}`);
      const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
      if (digest(buf) === digest(Buffer.from(await old.arrayBuffer()))) {
        after.at = new Date(Math.min(Date.parse(after.at), new Date(cam.last_snapshot_at).getTime())).toISOString();
      }
    }
    const path = `cameras/${cam.id}.jpg`;
    await upload(path, buf);
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    await db.query(
      "update public.property_cameras set snapshot_url=$1, last_snapshot_at=$3, last_synced_at=now(), updated_at=now() where id=$2",
      [publicUrl, cam.id, after.at],
    );
    ok++;
    log("ok", cam.name, `${(buf.length / 1024) | 0}KB`, `source_at=${after.at}`);
  } catch (e) {
    if (reachedCamera) {
      try {
        await db.query("update public.property_cameras set last_synced_at=now() where id=$1", [cam.id]);
      } catch (syncError) {
        log("FAIL", cam.name, `last_synced_at: ${syncError.message}`);
      }
    }
    log("FAIL", cam.name, e.message);
  } finally {
    if (capturePending) {
      try {
        await db.query("update public.property_cameras set capture_requested_at=null where id=$1", [cam.id]);
      } catch (clearError) {
        log("FAIL", cam.name, `clear capture request: ${clearError.message}`);
      }
    }
  }
}
await db.end();
log(`done ${ok}/${rows.length}`);
process.exit(ok === rows.length ? 0 : 1);
