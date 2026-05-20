@AGENTS.md

# Linear workflow

Cada vez que avanzo en un ticket WIK-XXX, **postear un comment en el ticket de Linear** con:

1. **Avance — In Review** (o "Done" según corresponda)
2. **Commit hash(es)** del trabajo
3. **Sección "Lo que se hizo"** — paths concretos de archivos modificados, lógica nueva, comportamiento esperado
4. **Sección "Qué chequear"** — pasos numerados que el user puede seguir para verificar visualmente que funciona

El tool es `mcp__linear-server__save_comment` con `issueId: "WIK-XXX"` y `body` en Markdown.

No esperar a que el user pida el comment — hacerlo automáticamente al cerrar cada ticket (cuando paso el state a In Review o Done). Si hay varios tickets en un mismo commit, postear comment separado en cada uno con el contexto específico de ese ticket.

Excepción: tickets archivados en Linear (campo `archivedAt` no nulo) rechazan comments con "Entity not found". En ese caso, avisar al user en el chat que no se pudo comentar.
