#!/usr/bin/env node
/**
 * Timelapse de los 7 hitos visuales clave del proyecto (WIK-198 final).
 *
 * Diferencia vs generate.mjs:
 *  - Lista FIJA de commits (no sampling) → 7 hitos curados, sin
 *    desperdicio en commits "intermedios" donde nada visual cambió.
 *  - Corre LOCAL (no GH Actions) → tenés .env.local y node_modules
 *    cacheado, evita los problemas de CI (env vars faltantes, npm
 *    install fresh hangs, etc.) que rompieron las 4 iteraciones cloud.
 *  - Más diagnóstico: imprime stdout/stderr del dev server inline
 *    cuando algo falla.
 *
 * Uso:
 *   node scripts/timelapse/milestones.mjs
 *
 * Output:
 *   - screenshots/milestone_NN_<sha>.png × 7
 *   - tero-bot-milestones.mp4
 */

import { spawn, execSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "screenshots-milestones");

const PORT = 3000;
const TARGET_URL = `http://localhost:${PORT}`;
const SERVER_TIMEOUT_MS = 120_000;
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const SCREENSHOT_WIDTH = 1440;
const SCREENSHOT_HEIGHT = 900;

// Los 7 hitos visuales del proyecto. Curados en base al git log + memoria
// de la sesión. Si querés agregar/quitar uno, editá esta lista.
const MILESTONES = [
  { sha: "7e7511c", label: "01. Initial Next.js scaffold" },
  { sha: "3a73585", label: "02. tero.bot brand collapse (WIK-131)" },
  { sha: "4c91c49", label: "03. Visual rebrand casabosque (WIK-135)" },
  { sha: "7b99d97", label: "04. Three modules cards (WIK-178)" },
  { sha: "b50f54f", label: "05. Light cream / Dark obsidian (WIK-199)" },
  { sha: "6963a66", label: "06. Stats abstract icons (WIK-203)" },
  { sha: "HEAD", label: "07. Current state" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function execGit(args) {
  return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(url, { method: "HEAD" }).catch(() => null);
    if (res && res.status < 500) return;
    await sleep(1000);
  }
  throw new Error(`server no respondió en ${timeoutMs}ms`);
}

async function killByPort(port) {
  try {
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, {
      stdio: "ignore",
      shell: "/bin/sh",
    });
  } catch {}
  // wait until port is free
  for (let i = 0; i < 10; i++) {
    try {
      execSync(`lsof -ti :${port}`, { stdio: "ignore" });
      await sleep(500);
    } catch {
      return;
    }
  }
}

async function captureCommit(sha, label, frameNum) {
  const short = sha === "HEAD" ? execGit("rev-parse --short HEAD") : sha.slice(0, 7);
  console.log(`\n[${frameNum}/${MILESTONES.length}] ${label} (${short})`);

  execGit(`checkout -f ${sha}`);
  console.log(`  · checkout OK`);

  try {
    execSync(`npm install --prefer-offline --no-audit --no-fund`, {
      cwd: REPO_ROOT,
      stdio: "ignore",
      timeout: 180_000,
    });
    console.log(`  · npm install OK`);
  } catch (e) {
    console.warn(`  ⚠ npm install falló: ${e.message.slice(0, 80)}`);
    return null;
  }

  await killByPort(PORT);

  const serverProc = spawn("sh", ["-c", "npm run dev"], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "pipe",
  });
  const buffer = [];
  const capture = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) {
        buffer.push(line);
        if (buffer.length > 80) buffer.shift();
      }
    }
  };
  serverProc.stdout?.on("data", capture);
  serverProc.stderr?.on("data", capture);

  let browser = null;
  let screenshotPath = null;
  try {
    await waitForServer(TARGET_URL, SERVER_TIMEOUT_MS);
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
    await sleep(2000); // settle animations + image load

    screenshotPath = path.join(
      OUTPUT_DIR,
      `milestone_${String(frameNum).padStart(2, "0")}_${short}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`  ✓ ${path.basename(screenshotPath)}`);
  } catch (err) {
    console.warn(`  ⚠ skip: ${err.message}`);
    if (buffer.length > 0) {
      console.warn(`  ┌─ últimas ${Math.min(15, buffer.length)} líneas del dev server ─`);
      for (const l of buffer.slice(-15)) console.warn(`  │ ${l}`);
      console.warn(`  └────────`);
    }
    screenshotPath = null;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc?.pid) {
      try { process.kill(-serverProc.pid, "SIGTERM"); } catch {}
      await sleep(500);
      try { process.kill(-serverProc.pid, "SIGKILL"); } catch {}
    }
    await killByPort(PORT);
    await sleep(3000); // cooldown
  }

  return screenshotPath;
}

async function main() {
  const originalRef = (() => {
    try { return execGit("rev-parse --abbrev-ref HEAD"); }
    catch { return execGit("rev-parse HEAD"); }
  })();
  console.log(`[milestones] original ref: ${originalRef}`);

  // Check working tree clean
  const status = execGit("status --porcelain");
  if (status) {
    console.error(`[milestones] working tree no está limpio. Comiteá o stash antes:\n${status}`);
    process.exit(1);
  }

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const cleanup = (sig) => {
    console.log(`\n[cleanup ${sig}] restaurando ${originalRef}…`);
    try { execGit(`checkout -f ${originalRef}`); } catch {}
    process.exit(sig === "SIGINT" ? 130 : 0);
  };
  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));

  let saved = 0;
  for (let i = 0; i < MILESTONES.length; i++) {
    const m = MILESTONES[i];
    const result = await captureCommit(m.sha, m.label, i + 1);
    if (result) saved++;
  }

  console.log(`\n[milestones] capturados ${saved}/${MILESTONES.length}`);
  console.log(`[milestones] restaurando ${originalRef}…`);
  execGit(`checkout -f ${originalRef}`);

  if (saved < 2) {
    console.warn(`[milestones] solo ${saved} frame(s) — no genero mp4.`);
    return;
  }

  // ffmpeg
  const mp4 = path.join(REPO_ROOT, "tero-bot-milestones.mp4");
  console.log(`\n[milestones] generando mp4...`);
  try {
    execSync(
      `ffmpeg -y -framerate 1 -pattern_type glob -i '${OUTPUT_DIR}/milestone_*.png' ` +
      `-c:v libx264 -pix_fmt yuv420p -vf 'pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=24' ` +
      `'${mp4}'`,
      { stdio: "inherit" },
    );
    console.log(`\n✓ Listo: ${mp4}`);
  } catch (e) {
    console.error(`\nffmpeg falló: ${e.message}`);
    console.log(`Las PNGs están en: ${OUTPUT_DIR}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
