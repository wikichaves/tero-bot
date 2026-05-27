#!/usr/bin/env node

/**
 * UI Timelapse generator (WIK-198).
 *
 * Itera por la historia de commits, levanta el dev server en cada uno,
 * captura una screenshot full-page con Playwright, y deja un set de PNGs
 * listos para `ffmpeg` (el comando exacto se imprime al final).
 *
 * Decisiones de diseño:
 *
 * 1. Sampling: tomamos ~50 commits distribuidos uniformemente en
 *    `git rev-list HEAD --reverse` (el oldest commit es el primer
 *    frame, el HEAD es el último). No procesamos cada commit porque
 *    son cientos y muchos viejos no compilan más.
 *
 * 2. Resilience: cada commit corre en su propio try/catch. Si el dev
 *    server no levanta dentro del timeout, o si Playwright falla, el
 *    commit se skipea y se sigue con el próximo. El usuario obtiene
 *    el subset de frames que sí funcionaron, no un crash.
 *
 * 3. Cleanup: el original branch se restaura siempre (try/finally
 *    en el outer loop). Si vos cancelás con Ctrl+C, el SIGINT handler
 *    también restaura.
 *
 * 4. Dev server: spawn como detached process group para poder matar
 *    todos sus children con un SIGTERM al PGID. Sin esto, los workers
 *    de Next quedan zombis y bloquean el puerto.
 *
 * 5. Caveat conocido: NO corremos `npm install` por commit (sería
 *    prohibitivamente lento). Usamos el `node_modules` que está ahora.
 *    Commits viejos que introdujeron deps nuevas pueden fallar el
 *    boot — los skipea resilience. Aceptable para el use case
 *    (showcase de UI, no audit de cada commit).
 */

import { spawn, execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// ─── CONFIG (modificar acá, no en el body) ───────────────────────────
const TARGET_URL = "http://localhost:3000";
const PORT = 3000;
// WIK-198 v2: 10 default — 50 colgaba la máquina porque Next dev server
// spawnea workers que NO mueren con SIGTERM al PGID. Cada iteración
// dejaba 500MB+ residual en RAM (Next + chromium). Con 10 + kill-port
// + cooldown, termina sin meter swap. Subí gradualmente si querés más.
//
// Override via env: SAMPLES_COUNT=50 npm run timelapse:gen
//
// WIK-198 v4: STRIDE — alternativa a SAMPLES_COUNT que toma 1 de cada N
// commits (uniformemente, en orden cronológico). Útil cuando crece el
// repo: en vez de "siempre 10 samples" da resolución constante. Si
// STRIDE está seteado, override a SAMPLES_COUNT. Default: stride=1
// (= sin stride, usar SAMPLES_COUNT).
const SAMPLES_COUNT = Number(process.env.SAMPLES_COUNT) || 10;
const STRIDE = Number(process.env.STRIDE) || 1;
const START_COMMAND = "npm run dev";
// WIK-198 v4: 90s era muy ajustado — el primer cold-boot de Next 16 dev
// en runners frescos (GH Actions) tomaba 100-140s y todos los commits
// timeouteaban. 240s da margen.
const DEV_SERVER_TIMEOUT_MS = 240_000;
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const SCREENSHOT_WIDTH = 1440;
const SCREENSHOT_HEIGHT = 900;
/** Sleep entre iteraciones — le da tiempo al OS para liberar RAM,
 *  cerrar file handles y descansar el disco antes del próximo boot. */
const COOLDOWN_MS = 3_000;
// ──────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "screenshots");

/** Promisified exec → captura stdout limpio, throw en non-zero. */
function execGit(args) {
  return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/** Sleep helper para waits. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Muestrea `n` items uniformemente espaciados de un array `arr`.
 * Garantiza primero y último siempre incluidos.
 */
function sampleEvenly(arr, n) {
  if (arr.length <= n) return [...arr];
  if (n <= 1) return [arr[arr.length - 1]];
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}

/**
 * Polling al TARGET_URL hasta que devuelva algo (200, 3xx, hasta 4xx
 * está bien — Next puede devolver 404 con todo levantado). 5xx = aún
 * no listo. Fallamos cuando supera el timeout.
 */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "HEAD" }).catch(() => null);
      if (res && res.status < 500) return;
    } catch {
      // network error → server aún levantando, seguimos polleando
    }
    await sleep(1000);
  }
  throw new Error(`Server no respondió en ${url} dentro de ${timeoutMs}ms`);
}

/**
 * Levanta el dev server como process group (`detached: true`). Devuelve
 * el ChildProcess; el caller usa `killServer` para terminarlo.
 */
function startDevServer() {
  return spawn("sh", ["-c", START_COMMAND], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "pipe",
  });
}

/**
 * Mata el dev server y TODOS sus descendants. Estrategia layered porque
 * Next.js spawnea workers que sobreviven al SIGTERM al PGID:
 *
 *  1. SIGTERM al PGID (graceful, mata al `npm run dev` y typically
 *     a sus children directos)
 *  2. SIGKILL al PGID después de 500ms (por si SIGTERM no fue suficiente)
 *  3. `kill-by-port`: matar cualquier proceso que SIGA escuchando al
 *     puerto. Esto cubre el caso típico donde Next workers sobreviven al
 *     kill del parent.
 *  4. Wait hasta que el puerto esté libre (max 5s) — si no se libera,
 *     ABORT antes que el próximo iter empiece a leak RAM exponencialmente.
 */
async function killServer(proc) {
  if (proc && !proc.killed && proc.pid) {
    try { process.kill(-proc.pid, "SIGTERM"); } catch {}
    await sleep(500);
    try { process.kill(-proc.pid, "SIGKILL"); } catch {}
    await sleep(200);
  }
  // Layer 2: matar lo que aún esté ocupando el puerto.
  await killByPort(PORT);
  // Layer 3: confirmar el puerto está libre antes de seguir.
  await waitForPortFree(PORT, 5_000);
}

/** Mata cualquier proceso escuchando al puerto. Cross-platform via lsof. */
async function killByPort(port) {
  try {
    // `lsof -t` devuelve solo PIDs, uno por línea. -i :PORT filtra
    // sólo los que tienen ese puerto. `kill -9` SIGKILL inmediato.
    execSync(
      `lsof -ti :${port} 2>/dev/null | xargs -r kill -9 2>/dev/null || true`,
      { stdio: "ignore", shell: "/bin/sh" },
    );
  } catch {
    // Cualquier error en el pipe — lsof no devolvió nada o no está
    // instalado. No es fatal.
  }
}

/** Polling hasta que el puerto se libere. Throws si no pasa en `timeoutMs`. */
async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync(`lsof -ti :${port} 2>/dev/null`, { stdio: "ignore" });
      // Sigue alguien — esperamos
      await sleep(300);
    } catch {
      // lsof exit code 1 = nadie en el puerto. ✓
      return;
    }
  }
  throw new Error(
    `Puerto ${port} sigue ocupado después de ${timeoutMs}ms — aborting para no leak RAM`,
  );
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Guardar branch original para restaurar al final.
  const originalRef = (() => {
    try {
      const branch = execGit("rev-parse --abbrev-ref HEAD");
      if (branch && branch !== "HEAD") return branch;
    } catch {
      // fall through
    }
    // detached HEAD → guardamos el SHA
    return execGit("rev-parse HEAD");
  })();
  console.log(`[timelapse] original ref: ${originalRef}`);

  // Cleanup handler — si el user cancela, restauramos antes de salir.
  let cleanupRan = false;
  const cleanup = (signal) => {
    if (cleanupRan) return;
    cleanupRan = true;
    console.log(`\n[timelapse] cleanup (${signal})…`);
    try {
      execGit(`checkout -f ${originalRef}`);
      console.log(`[timelapse] restored to ${originalRef}`);
    } catch (e) {
      console.error(`[timelapse] could not restore: ${e.message}`);
    }
    process.exit(signal === "SIGINT" ? 130 : 0);
  };
  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));

  const allCommits = execGit("rev-list HEAD --reverse").split("\n").filter(Boolean);
  console.log(`[timelapse] total commits: ${allCommits.length}`);

  // STRIDE > 1: 1 de cada N en orden cronológico (más HEAD para garantizar
  // el último). STRIDE === 1: sample uniforme de SAMPLES_COUNT.
  let samples;
  if (STRIDE > 1) {
    samples = [];
    for (let i = 0; i < allCommits.length; i += STRIDE) samples.push(allCommits[i]);
    // Forzar que el último commit (HEAD) esté siempre incluido.
    if (samples[samples.length - 1] !== allCommits[allCommits.length - 1]) {
      samples.push(allCommits[allCommits.length - 1]);
    }
    console.log(`[timelapse] stride=${STRIDE} → sampling ${samples.length} commits`);
  } else {
    samples = sampleEvenly(allCommits, SAMPLES_COUNT);
    console.log(`[timelapse] sampling ${samples.length} commits (evenly spaced)`);
  }

  let savedCount = 0;
  const failures = [];

  try {
    for (let i = 0; i < samples.length; i++) {
      const commit = samples[i];
      const short = commit.slice(0, 7);
      const frameNum = String(i + 1).padStart(3, "0");
      const outputPath = path.join(OUTPUT_DIR, `frame_${frameNum}_${short}.png`);
      console.log(`\n[${i + 1}/${samples.length}] ${short}`);

      let serverProc = null;
      let browser = null;
      try {
        execGit(`checkout -f ${commit}`);

        // WIK-198 v5: reinstall deps por commit. Sin esto, los commits
        // viejos fallaban silenciosamente — el node_modules instalado
        // matchea el HEAD actual (Next 16 + deps modernas), pero los
        // commits previos pedían Next 14/15 o paquetes que no existían
        // todavía. `npm install` actualiza node_modules al lockfile del
        // commit actual. `--prefer-offline --no-audit --no-fund` lo
        // baja a ~10-20s usando el cache de npm (que el setup-node
        // action ya tiene warm). En caso de error, seguimos: skip
        // explícito en lugar de explosión silenciosa.
        try {
          execSync(`npm install --prefer-offline --no-audit --no-fund`, {
            cwd: REPO_ROOT,
            stdio: "ignore",
            timeout: 180_000,
          });
        } catch (installErr) {
          console.warn(`  ⚠ npm install falló — skipeando este commit`);
          failures.push({
            commit: short,
            reason: `npm install: ${installErr.message.slice(0, 80)}`,
          });
          continue;
        }

        serverProc = startDevServer();
        // WIK-198 v6: capturamos el output del dev server en un ring
        // buffer para poder imprimirlo si el commit falla. Esto evita
        // el ruido normal en runs exitosos pero da diagnóstico cuando
        // algo se rompe ("dev server crasheó / mostró este stack").
        const SERVER_BUFFER_MAX = 60; // últimas 60 líneas
        const serverBuffer = [];
        const captureLine = (line) => {
          serverBuffer.push(line);
          if (serverBuffer.length > SERVER_BUFFER_MAX) serverBuffer.shift();
        };
        const captureChunk = (chunk) => {
          for (const line of chunk.toString().split(/\r?\n/)) {
            if (line.trim()) captureLine(line);
          }
        };
        serverProc.stdout?.on("data", captureChunk);
        serverProc.stderr?.on("data", captureChunk);

        await waitForServer(TARGET_URL, DEV_SERVER_TIMEOUT_MS);
        console.log(`  · server ready`);

        browser = await chromium.launch({ headless: true });
        const ctx = await browser.newContext({
          viewport: { width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT },
        });
        const page = await ctx.newPage();
        await page.goto(TARGET_URL, {
          waitUntil: "networkidle",
          timeout: PAGE_LOAD_TIMEOUT_MS,
        });
        // Settle adicional: a veces hay animaciones de mount tardías.
        await sleep(1500);
        await page.screenshot({ path: outputPath, fullPage: true });
        savedCount++;
        console.log(`  ✓ ${path.basename(outputPath)}`);
      } catch (err) {
        const reason = err.message.split("\n")[0].slice(0, 120);
        console.warn(`  ⚠ skip: ${reason}`);
        // WIK-198 v6: imprimir últimas líneas del dev server si el commit
        // falló. Sin esto, los timeouts a 240s eran ciegos — no sabíamos
        // si el server crashea, se cuelga compilando, o nunca arranca.
        if (typeof serverBuffer !== "undefined" && serverBuffer.length > 0) {
          const tail = serverBuffer.slice(-15);
          console.warn(`  ┌─ últimas ${tail.length} líneas del dev server ─`);
          for (const l of tail) console.warn(`  │ ${l}`);
          console.warn(`  └────────────────────────────────────────`);
        }
        failures.push({ commit: short, reason });
      } finally {
        if (browser) await browser.close().catch(() => {});
        if (serverProc) await killServer(serverProc);
        // Cooldown — RAM free, file handles close, disco descansa antes
        // del próximo boot. Sin esto, después de ~5 iteraciones la
        // máquina entra a swap y se cuelga (probado experimentalmente).
        if (i < samples.length - 1) {
          console.log(`  · cooldown ${COOLDOWN_MS / 1000}s`);
          await sleep(COOLDOWN_MS);
        }
      }
    }
  } finally {
    // Restore original ref siempre, incluso si el loop tiró excepción
    // que no atrapamos.
    console.log(`\n[timelapse] restoring to ${originalRef}`);
    try {
      execGit(`checkout -f ${originalRef}`);
    } catch (e) {
      console.error(`Could not restore: ${e.message}`);
    }
  }

  console.log(
    `\n[timelapse] done. saved: ${savedCount}/${samples.length} · failed: ${failures.length}`,
  );
  if (failures.length > 0 && failures.length <= 20) {
    console.log("Failures:");
    for (const f of failures) console.log(`  ${f.commit}: ${f.reason}`);
  }

  // ── ffmpeg command ──
  // Pad a dimensions pares — requerido por yuv420p y por la mayoría
  // de los reproductores de video. fullPage screenshots pueden tener
  // alturas impares según el contenido.
  const outVideo = path.join(REPO_ROOT, "tero-bot-timelapse.mp4");
  console.log(`\nNext step — generar el video con ffmpeg:\n`);
  console.log(
    `ffmpeg -framerate 10 -pattern_type glob -i '${OUTPUT_DIR}/frame_*.png' \\\n` +
      `  -c:v libx264 -pix_fmt yuv420p \\\n` +
      `  -vf 'pad=ceil(iw/2)*2:ceil(ih/2)*2' \\\n` +
      `  '${outVideo}'\n`,
  );
}

main().catch((err) => {
  console.error("[timelapse] FATAL:", err);
  process.exit(1);
});
