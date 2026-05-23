# WIK-97: Tero Bot ↔ Linear ↔ Claude autónomo

**Estado**: P1 implementado (commit `8752773`). P2–P5 documentados como
sub-issues (WIK-136 → WIK-139).

Este doc es la **guía de setup + testing mobile-friendly** para activar
el sistema. Pensado para leer desde el celular durante el viaje.

---

## 1. Qué se construyó

| Pieza | Archivo | Función |
|---|---|---|
| Cmd `linear` | `src/lib/whatsapp/commands.ts` + `src/lib/linear/create-issue.ts` | Crea Linear issue desde WhatsApp |
| Cmd `claude` | mismo | Encola prompt como Linear issue con label `claude:autonomous` |
| Worker autónomo | `.github/workflows/claude-worker.yml` | GH Action que corre Claude Code headless sobre un ticket → abre PR |
| Picker | `.github/scripts/pick-claude-ticket.mjs` | Query a Linear para el siguiente ticket del worker |

Todo gated a `admin`/`gestor` por `isAuthorizedCommandSender`.

---

## 2. Setup (15-20 min, todo desde mobile/browser)

### 2a. Linear API token → Vercel env

Habilita el cmd `linear` y `claude` desde WhatsApp.

1. Browser: https://linear.app/wikichaves/settings/api
2. Tab **Personal API keys** → "Create key" → nombre `tero-bot` → copiar token (`lin_api_...`)
3. Browser: https://vercel.com/wikichaves/tero-bot/settings/environment-variables
4. Add: name `LINEAR_API_TOKEN` value `lin_api_...` env `Production` + `Preview`
5. Vercel → Deployments → último → "Redeploy" para que tome la env nueva

**Test**: WhatsApp al bot → `linear test desde mobile`. Respuesta esperada:
> 🎫 *Ticket creado*
>
> **WIK-XXX**: test desde mobile
>
> _https://linear.app/wikichaves/issue/WIK-XXX/..._

Si falla: `❌ No pude crear el ticket: LINEAR_API_TOKEN no está configurado` → la env no se aplicó, redeploy de nuevo.

### 2b. Label en Linear

Para que el worker pueda filtrar.

1. https://linear.app/wikichaves/settings/labels (o desde un issue: "Add label" → escribir el nombre nuevo)
2. Crear label `claude:autonomous` (color amarillo o el que quieras)

### 2c. GitHub Actions secrets

Habilita el worker autónomo.

1. Anthropic API key:
   - https://console.anthropic.com/settings/keys → "Create Key"
   - Copiar `sk-ant-...`
2. GitHub repo secrets:
   - https://github.com/wikichaves/tero-bot/settings/secrets/actions
   - "New repository secret":
     - `ANTHROPIC_API_KEY` = `sk-ant-...`
     - `LINEAR_API_TOKEN` = `lin_api_...` (mismo que pusiste en Vercel)
3. Workflow permissions:
   - https://github.com/wikichaves/tero-bot/settings/actions
   - Section "Workflow permissions" → seleccionar **Read and write permissions**
   - Tildar **"Allow GitHub Actions to create and approve pull requests"**
   - Save

---

## 3. Testing end-to-end (todo desde mobile)

### Test 1: cmd `linear` (admin → Linear)

```
WhatsApp → tu bot:  linear arreglar el bug del bird (test)
```

Respuesta esperada en 2-5 seg:
> 🎫 *Ticket creado*
>
> **WIK-XXX**: arreglar el bug del bird (test)
>
> _https://linear.app/wikichaves/issue/WIK-XXX/..._

Abrí el link en mobile → debe ver el ticket en Linear con estado `Todo` o `Backlog`, sin label, sin asignar.

**Variantes a probar**:
- `linear urgente fix critical bug` → priority Urgent (1) en Linear
- `linear alto refactor del header` → priority High (2)
- `linear bajo limpiar imports` → priority Low (4)
- Multi-línea (mandar como mensajes separados de WhatsApp? hmm — WhatsApp no soporta multi-line en el input. **Limitation**: por ahora título de una sola línea, descripción no se puede hoy desde WA. Si necesitás description, agregala desde la app de Linear después).

### Test 2: cmd `claude` (admin → cola autónoma)

```
WhatsApp → tu bot:  claude reorganizar las cards del dashboard para que sean grid 2x2
```

Respuesta:
> 🤖 *Trabajo encolado para Claude*
>
> **WIK-XXX**: reorganizar las cards del dashboard para que sean grid 2x2
>
> _https://linear.app/wikichaves/issue/WIK-XXX/..._
>
> Cuando el worker corra (diario o on-demand) lo levanta.

En Linear: ticket con label `claude:autonomous`. El prompt completo va al description.

### Test 3: worker autónomo (manual trigger)

1. Asegurate de tener ≥1 ticket con label `claude:autonomous` (creá uno con `linear` cmd y agregale el label desde Linear, o usá el cmd `claude` para crearlo con el label automático).
2. https://github.com/wikichaves/tero-bot/actions/workflows/claude-worker.yml
3. "Run workflow" (dropdown derecha) → branch `main` → "Run workflow"
4. Esperá ~3-10 min (depende del trabajo)
5. Si todo bien → tab Pull requests del repo → nuevo PR `claude/WIK-XXX: ...`

Revisá el diff desde la app de GitHub mobile. Si el cambio se ve bien:
- Tap "Merge" en el PR → Vercel deploya solo en 2-3 min

Si el diff está raro:
- Tap "Close pull request" — el ticket queda en Linear sin tocar
- O dejá el PR abierto y comentás en Linear qué ajustar; el próximo run lo retoma

**Forzar un ticket específico**:
- En "Run workflow", llenar el input `ticket_id` con `WIK-150` (o el que sea)
- Útil para re-correr si el primer intento falló

---

## 4. Costos estimados

| Item | Costo | Frecuencia |
|---|---|---|
| Anthropic API (Claude Sonnet 4.7 vía Claude Code) | $0.30 - $1.50 por run | depende de complejidad del ticket |
| GitHub Actions | gratis | 2000 min/mes incluidos en plan Pro; cada run usa 5-15 min |
| Linear API | gratis | sin rate limit razonable |
| Vercel env vars | gratis | sin costo |

**Estimación mensual** si dejás cron diario: ~$15-30 USD en Anthropic (un ticket por día). Para no sorprenderte:
- Anthropic console → Settings → Usage limits → setear `Monthly limit` en $50 o lo que te tranquilice.

---

## 5. Riesgos + mitigaciones

| Riesgo | Mitigación actual | Mejorable |
|---|---|---|
| Claude rompe algo en main | No auto-merge — vos revisás cada PR | WIK-137: agregar CI gate (lint+build) antes de merge |
| Token de Linear / Anthropic se leakea | Secrets en GH Actions encriptados; no en repo | Rotar keys cada 3 meses |
| Costo descontrolado | Hard limit en Anthropic console | WIK-136: rate limit del worker (si >5 PRs autonomous abiertos, skipear) |
| Worker se queda colgado | `timeout-minutes: 30` corta el run | — |
| PR queda abierto sin revisión | Visible en GH mobile / Linear | WIK-138: WhatsApp ping cuando se abre un PR |
| WhatsApp 24h window — el bot no te puede pingear fuera de la conversación activa | Mandale `linear ping` cada par de días para mantener la ventana abierta | Pre-approved Meta template (WIK-138) |

---

## 6. Roadmap (sub-issues creadas)

- **WIK-136** — habilitar cron del worker (descomentar 2 líneas en `claude-worker.yml`)
- **WIK-137** — auto-merge cuando CI pasa (requiere ci.yml + branch protection antes)
- **WIK-138** — notificación WhatsApp cuando worker abre PR
- **WIK-139** — cmd `claude trabajá ya` que dispara el worker on-demand

Las prioridades sugeridas:
1. Probar P1 con un ticket real (Test 3 arriba) — sin eso el resto no tiene sentido
2. Si funciona bien → WIK-138 (notificación WA) para no tener que chequear GitHub manualmente
3. Cuando el flow esté validado → WIK-136 (cron diario)
4. Mucho después → WIK-137 (auto-merge, con todos los gates de CI/CODEOWNERS)

---

## 7. Debugging

### El cmd `linear` no responde nada en WhatsApp

- Verificá que tu número WhatsApp esté en el campo `whatsapp` de un profile con role `admin` o `gestor` en Supabase: https://supabase.com/dashboard/project/<your>/editor → `profiles` table.
- Si no estás en la 24h-window con el bot, mandale primero `ayuda` para reabrirla.
- Check logs en Vercel: https://vercel.com/wikichaves/tero-bot/deployments → último → "Functions" tab → buscá `/api/whatsapp`.

### El worker corre pero no abre PR

Posibles causas:
1. Claude no produjo cambios → log dirá "Claude no hizo cambios. Skipping PR." → editá el ticket en Linear con instrucciones más específicas y re-corré
2. `npm run build` falla → log mostrará el error → mismo fix
3. Permisos de workflow → ver Setup 2c step 3

### Linear MCP en mi Claude local da 401

Tiene que ver con tu cliente local, no con el bot en producción. El bot usa `LINEAR_API_TOKEN` (PAT, no OAuth) y eso no expira. Si querés volver a darle a tu Claude local acceso a Linear:
- `claude mcp remove linear-server` y `claude mcp add --transport http linear-server https://mcp.linear.app/mcp` para refrescar OAuth

---

## 8. Notas para futuro

- **Modo conversacional con Claude vía WhatsApp**: para tener un "chat" en vivo con Claude sobre el codebase (no solo encolar tickets), habría que armar un endpoint que mantenga estado de conversación + llame Anthropic Messages API. Es WIK-140 candidata.
- **Multi-ticket por run**: hoy el worker hace un ticket por vez. Podría hacer N tickets en paralelo en jobs separados — pero hay que cuidar conflictos de merge.
- **Self-modification**: el worker puede tocar `.github/workflows/claude-worker.yml`. Si rompe el workflow, el próximo run no corre. Si no querés ese riesgo, agregá `.github/**` a CODEOWNERS requiriendo tu approval.
