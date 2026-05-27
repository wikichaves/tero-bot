@AGENTS.md

# Idioma

Respondé en español rioplatense. Código y nombres de variables siempre en inglés.

# Linear workflow

Cada vez que avanzo en un ticket WIK-XXX, **postear un comment en el ticket de Linear** con:

1. **Avance — In Review** (o "Done" según corresponda)
2. **Commit hash(es)** del trabajo
3. **Sección "Lo que se hizo"** — paths concretos de archivos modificados, lógica nueva, comportamiento esperado
4. **Sección "Qué chequear"** — pasos numerados que el user puede seguir para verificar visualmente que funciona

El tool es `mcp__linear-server__save_comment` con `issueId: "WIK-XXX"` y `body` en Markdown.

No esperar a que el user pida el comment — hacerlo automáticamente al cerrar cada ticket (cuando paso el state a In Review o Done). Si hay varios tickets en un mismo commit, postear comment separado en cada uno con el contexto específico de ese ticket.

Excepción: tickets archivados en Linear (campo `archivedAt` no nulo) rechazan comments con "Entity not found". En ese caso, avisar al user en el chat que no se pudo comentar.

# Vacation mode

Cuando el user esté de vacaciones (sin compu), el `claude-worker` corre desatendido. Reglas de seguridad:

- **No auto-merge.** El worker abre PRs; el user los revisa desde GitHub mobile. Nunca mergear desde Claude Code.
- **No deploy directo a `main`.** Todo cambio pasa por PR + CI.
- **Si un cron falla repetidamente**, abrir un ticket en Linear con label `claude:autonomous` describiendo el error y los logs. **No** intentar auto-fix de crons que fallaron — diagnóstico únicamente.
- **Cambios en paths de `CODEOWNERS`** (whatsapp, telegram, tuya, bills, airbnb, sensors, alarm-reminders, supabase, auth, api, schema, deploy config): el worker puede proponer en PR, pero el comentario al ticket debe decir explícitamente "**requiere review humana — no mergear sin el user**".
- **Ante duda**: parar, comentar en el ticket de Linear, dejar que el user resuelva al volver.
