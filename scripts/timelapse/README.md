# UI Timelapse generator

Standalone tool (WIK-198) que itera por la historia de commits, levanta el
dev server en cada uno, captura una screenshot full-page con Playwright,
y deja PNGs numerados listos para `ffmpeg`.

## Setup (one-time)

```bash
cd scripts/timelapse
npm install
# El postinstall corre automáticamente:
#   playwright install chromium
# (~150MB del browser headless; queda cacheado entre runs)
```

## Run

Desde **el root del repo** (para que el dev server arranque con el `package.json` de tero-bot):

```bash
cd ~/code/tero-bot
node scripts/timelapse/generate.mjs
```

Toma ~30-60 min para 50 commits (cada commit: 5-10s checkout + 20-40s dev
server boot + 2s screenshot + 1s kill). El terminal va a imprimir progreso
y al final el comando exacto de `ffmpeg`.

## Config

Editar las constantes al tope de `generate.mjs`:

| Var | Default | Para qué |
|---|---|---|
| `TARGET_URL` | `http://localhost:3000` | URL que screenshotea (root del landing) |
| `SAMPLES_COUNT` | `50` | Cuántos commits muestrear de la historia |
| `START_COMMAND` | `npm run dev` | Cómo levantar el server |
| `DEV_SERVER_TIMEOUT_MS` | `90000` | Cuánto esperar al boot del server |
| `SCREENSHOT_WIDTH` | `1440` | Viewport width |
| `SCREENSHOT_HEIGHT` | `900` | Viewport height |

## Output

- `screenshots/frame_001_<sha>.png` … `frame_050_<sha>.png` en el root del repo (gitignored)
- Al final imprime el comando `ffmpeg` para stitchearlas en un `.mp4` 10fps

## Caveats

1. **No corre `npm install` por commit** — usa el `node_modules` actual.
   Commits viejos que introdujeron deps nuevas pueden fallar el boot.
   Esos commits se skipean (resilience), no rompen el run.

2. **Branch restore garantizado**: el script guarda el branch original
   y lo restaura al final (incluso si vos cancelás con Ctrl+C via SIGINT
   handler).

3. **Process group cleanup**: el dev server se mata con SIGTERM al PGID
   para incluir workers de Next que de otra forma quedarían zombis y
   bloquearían el puerto 3000.

4. **Caveat de stats.generated.json**: el `prebuild` regenera el archivo
   pidiendo a la GitHub API. Si rate-limita o la API está down,
   el dev server puede tardar más en bootear. El timeout de 90s suele
   alcanzar.
