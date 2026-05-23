# WIK-97: Tero Bot ↔ Telegram ↔ Linear ↔ Claude autónomo

**Estado**: P1 implementado.
**Canal**: Telegram (no WhatsApp — ver "Por qué Telegram" abajo).

Esta es la guía de setup + testing mobile-friendly para activar el sistema.
Pensado para leer desde el celular durante el viaje.

---

## 1. Qué se construyó

```
Telegram (@your_dev_bot)  →  /api/telegram  →  /linear, /claude (admin only)
                                                    ↓
                                              crea Linear issue
                                                    ↓
                              (con label claude:autonomous para /claude)
                                                    ↓
                              GitHub Action "Claude worker" (manual o cron)
                                                    ↓
                                          Claude Code headless
                                                    ↓
                                              abre PR en GitHub
                                                    ↓
                                  vos mergéas desde GitHub mobile → Vercel deploy
```

| Pieza | Archivo | Función |
|---|---|---|
| Cmd parser/handlers | `src/lib/admin-commands/index.ts` | Lógica de `/linear` y `/claude`, agnóstica del transport |
| Cliente Telegram | `src/lib/telegram/index.ts` | sendMessage, auth helpers |
| Webhook handler | `src/app/api/telegram/route.ts` | Recibe updates de Telegram |
| Linear client | `src/lib/linear/create-issue.ts` | GraphQL raw, crea issues |
| Worker autónomo | `.github/workflows/claude-worker.yml` | Levanta tickets `claude:autonomous`, abre PR |
| Picker | `.github/scripts/pick-claude-ticket.mjs` | Query Linear para el próximo ticket |

---

## 2. Por qué Telegram (no WhatsApp)

Originalmente el plan era usar el bot existente de WhatsApp para `/linear` y `/claude`. Reconsideramos porque:

- **24h window**: WA solo deja mandar free-form dentro de la conversación activa. Templates pre-aprobados para pingear fuera. Telegram: ninguna restricción.
- **Code blocks**: WA no soporta ``` multi-línea. Telegram sí — esencial para mostrar diffs/logs.
- **Comandos nativos**: Telegram tiene menú `/` con autocomplete. WA no.
- **Setup**: Telegram es `@BotFather` → token. WA es Meta + Kapso + templates aprobados.
- **Costo**: Telegram gratis. WA paga por mensaje (después de los primeros 1000/mes).
- **Inline buttons**: en cualquier mensaje en Telegram, solo en templates en WA.

WhatsApp queda como el canal del **staff** (cleaning, mantenimiento, fotos de tareas) — para eso es ideal porque ya lo usan diariamente. Telegram es el canal del **developer** (vos).

---

## 3. Setup (todo desde el celular, ~10 min)

### 3a. Crear el bot en Telegram

1. Abrir Telegram en el celular
2. Buscar `@BotFather` → start
3. Mandarle `/newbot`
4. Cuando pida nombre: algo descriptivo, ej `Tero Dev Bot`
5. Cuando pida username: termina en `bot`, ej `tero_dev_bot` o `wikichaves_dev_bot`
6. **Copiar el token** que devuelve (formato `1234567890:ABCDef...`). Lo necesitás en el paso 3c.

Opcional pero recomendado: configurá la lista de comandos para que aparezcan en autocomplete:
- Mandar `/setcommands` a `@BotFather`
- Elegir tu bot
- Pegar:
  ```
  linear - Crear ticket Linear
  claude - Encolar trabajo para Claude
  help - Ver comandos disponibles
  ```

### 3b. Generar el secret token

El secret token es lo que valida que los requests vienen de Telegram y no de un atacante random.

Desde browser, abrir https://generate-secret.vercel.app/32 o cualquier generador de strings hex. O en cualquier terminal:
```bash
openssl rand -hex 32
```
Te da algo tipo `7a4f...b9c1`. **Copialo, lo usás en 3c y 3e.**

### 3c. Linear API token

Browser: https://linear.app/wikichaves/settings/api → tab "Personal API keys" → "Create key" → nombre `tero-dev-bot` → copiar el token (`lin_api_...`).

### 3d. Setear env vars en Vercel + redeploy

Browser: https://vercel.com/wikichaves/tero-bot/settings/environment-variables

Agregar (env `Production` + `Preview`):

| Name | Value |
|---|---|
| `LINEAR_API_TOKEN` | El `lin_api_...` del paso 3c |
| `TELEGRAM_BOT_TOKEN` | El `1234567890:ABC...` del paso 3a |
| `TELEGRAM_WEBHOOK_SECRET` | El hex del paso 3b |
| `TELEGRAM_ADMIN_CHAT_ID` | **Dejá vacío por ahora** — lo seteás en 3f |

Después → Vercel → Deployments → último → "Redeploy" para que tome las envs.

### 3e. Registrar el webhook con Telegram

Una vez deployado, le decís a Telegram dónde mandar los updates.

Desde el browser mobile, abrir esta URL (reemplazá `<TOKEN>` y `<SECRET>` con los tuyos):
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tero.bot/api/telegram&secret_token=<SECRET>
```

Debería responder algo como:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

Verificar que quedó bien:
```
https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```
Debería mostrar tu URL + has_custom_certificate: false + last_error_date: 0.

### 3f. Descubrir tu chat_id

Ahora abrí el chat con tu bot en Telegram y mandale `/start` (o cualquier cosa).

El bot te responde con tu `chat_id` (porque todavía no está seteado el admin). Algo tipo:
> 👋 Hola Wiki.
>
> Tu chat_id es `123456789`.
>
> Copiá ese número y agregalo como env var TELEGRAM_ADMIN_CHAT_ID en Vercel...

Volvé a Vercel → env vars → seteá `TELEGRAM_ADMIN_CHAT_ID` con ese número → redeploy.

### 3g. Crear label en Linear

Para que el worker filtre tickets:
1. https://linear.app/wikichaves/settings/labels
2. New label → name `claude:autonomous` → color amarillo → save.

### 3h. GitHub Actions secrets (para el worker)

1. Anthropic API key: https://console.anthropic.com/settings/keys → "Create Key" → copiar `sk-ant-...`
2. Tener el `lin_api_...` del paso 3c a mano.
3. Browser: https://github.com/wikichaves/tero-bot/settings/secrets/actions
4. "New repository secret":
   - `ANTHROPIC_API_KEY` = `sk-ant-...`
   - `LINEAR_API_TOKEN` = `lin_api_...`
5. https://github.com/wikichaves/tero-bot/settings/actions → "Workflow permissions" → **Read and write permissions** + tildar **"Allow GitHub Actions to create and approve pull requests"** → save.

---

## 4. Testing end-to-end (todo desde mobile)

### Test 1: bot responde

```
Telegram → tu bot:  /help
```
Debe responder con el listado de comandos formateado.

### Test 2: /linear

```
Telegram → tu bot:  /linear arreglar bug del header (test desde mobile)
```

Respuesta esperada (~2 seg):
> 🎫 **Ticket creado**
>
> **WIK-XXX**: arreglar bug del header (test desde mobile)
>
> https://linear.app/wikichaves/issue/WIK-XXX/...

Tap el link → debe abrir Linear con el ticket creado en estado Backlog/Todo, sin asignar.

**Variantes a probar**:
- `/linear urgente test crítico` → priority Urgent
- `/linear alto test high` → priority High
- `/linear bajo test low` → priority Low
- Multi-línea (en Telegram podés usar Shift+Enter en desktop, o enter normal en mobile):
  ```
  /linear refactor de site-header
  
  Reorganizar el menú de Configuración para que tenga separadores claros.
  Tocar src/components/site-header.tsx.
  ```
  → el ticket se crea con el primer renglón como title y el resto como description.

### Test 3: /claude (encola trabajo)

```
Telegram → tu bot:  /claude limpiar imports no usados en src/app/dashboard
```

Respuesta:
> 🤖 **Trabajo encolado para Claude**
>
> **WIK-XXX**: limpiar imports no usados en src/app/dashboard
>
> https://linear.app/wikichaves/issue/WIK-XXX/...
>
> _Cuando el worker corra (manual o cron) lo levanta._

En Linear: el ticket queda con label `claude:autonomous`. El worker lo va a levantar en el próximo run.

### Test 4: worker autónomo (manual)

1. Asegurate que hay ≥1 ticket con label `claude:autonomous` (creá uno con `/claude` arriba).
2. https://github.com/wikichaves/tero-bot/actions/workflows/claude-worker.yml
3. "Run workflow" (dropdown arriba derecha) → branch `main` → "Run workflow"
4. Esperá 3-10 min (depende de la complejidad del trabajo)
5. Si todo bien → tab "Pull requests" del repo → nuevo PR `claude/WIK-XXX: ...`

Revisás el diff desde GitHub mobile. Si está bien:
- Tap "Merge pull request" → Vercel deploya solo en 2-3 min

Si no:
- Tap "Close pull request" — el ticket sigue en Linear sin tocar
- Editás el ticket con instrucciones más específicas y re-corrés el workflow

**Forzar un ticket específico**: en "Run workflow", llená `ticket_id` con `WIK-150` (o el que sea). Útil para retry.

---

## 5. Costos estimados

| Item | Costo | Frecuencia |
|---|---|---|
| Telegram | gratis | siempre |
| Linear API | gratis | sin rate limit razonable |
| Anthropic API (Claude Sonnet 4.7 vía Claude Code) | $0.30 - $1.50 por run | depende de complejidad |
| GitHub Actions | gratis | 2000 min/mes (plan Pro); cada run usa 5-15 min |
| Vercel hosting | gratis | sin costo extra |

**Si activás cron diario**: ~$15-30 USD/mes en Anthropic. Para evitar sorpresas, en https://console.anthropic.com/settings/limits seteá un Monthly limit de $50.

---

## 6. Riesgos + mitigaciones

| Riesgo | Mitigación actual | Mejorable |
|---|---|---|
| Claude rompe algo en main | No auto-merge — vos revisás cada PR | WIK-137: agregar CI gate (lint+build) antes de merge |
| Tokens leakean | Secrets en Vercel + GH Actions (encriptados) | Rotar cada 3 meses |
| Costo descontrolado en Anthropic | Hard limit en console | WIK-136: rate limit del worker |
| Worker se cuelga | `timeout-minutes: 30` corta | — |
| Bot respondiendo a strangers | `TELEGRAM_ADMIN_CHAT_ID` filtra | — |
| Webhook hijack | `TELEGRAM_WEBHOOK_SECRET` valida cada POST | — |
| PR abierto sin revisión | Visible en GitHub mobile + email | WIK-138: notificación Telegram al abrir PR |

---

## 7. Roadmap (sub-issues)

- **WIK-136** — habilitar cron del worker (descomentar 2 líneas)
- **WIK-137** — auto-merge cuando CI pasa (requiere ci.yml + branch protection)
- **WIK-138** — notificación **Telegram** cuando worker abre PR (ahora trivial — no necesita templates aprobados como WA)
- **WIK-139** — cmd `/work` que dispara el worker on-demand vía GitHub REST

Prioridad sugerida:
1. Test end-to-end con un ticket real (Test 4)
2. WIK-138 (notif Telegram al abrir PR) — alta utilidad, bajo esfuerzo ahora
3. WIK-139 (`/work`)
4. WIK-136 (cron diario)
5. WIK-137 (auto-merge, con CI gates) — bastante después

---

## 8. Debugging

### El bot no responde a nada

1. Verificá que el webhook esté seteado:
   ```
   https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   ```
   `pending_update_count` debería ser 0 o crecer al mandar mensajes.
2. Endpoint vivo:
   ```
   curl https://tero.bot/api/telegram
   ```
   Devuelve JSON con `configured: { bot_token: true, admin_chat_id: true, webhook_secret: true, linear_token: true }`. Si alguno es false → env var falta.
3. Logs de Vercel: https://vercel.com/wikichaves/tero-bot/logs → filtrar por `/api/telegram`.

### El bot dice "Tu chat_id es X" pero no procesa comandos

Te falta setear `TELEGRAM_ADMIN_CHAT_ID` en Vercel con ese número, y redeployar.

### `/linear` da "No pude crear el ticket: LINEAR_API_TOKEN no está configurado"

`LINEAR_API_TOKEN` falta en Vercel env. Setearlo y redeploy.

### El worker corre pero no abre PR

Causas:
1. Claude no produjo cambios → log: "Claude no hizo cambios. Skipping PR." → editá el ticket con instrucciones más específicas y re-corré
2. `npm run build` falla → log muestra el error
3. Permisos de workflow → setup 3h step 5

### Linear MCP en mi cliente local da 401

No relacionado con el bot (ese usa PAT, no OAuth). Para tu Claude local:
```bash
claude mcp remove linear-server
claude mcp add --transport http linear-server https://mcp.linear.app/mcp
```
Y re-autenticás.
