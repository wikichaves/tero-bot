#!/usr/bin/env node
// Mueve un ticket de Linear a un estado destino (WIK-237).
//
// Lo usa el worker autónomo después de abrir un PR: mueve el ticket de
// "Todo" (type=unstarted) a "In Review" para sacarlo de la queue del
// picker (`pick-claude-ticket.mjs` filtra por state.type=unstarted). Sin
// esto, el mismo ticket se re-procesa en la próxima corrida → PRs
// duplicados + conflicts (caso WIK-235, donde #54 chocó contra #53 ya
// mergeado).
//
// Uso:
//   node move-ticket-state.mjs <ticket-uuid> <target-state>
//
//   <ticket-uuid>   el `id` interno de Linear (no el identifier tipo
//                   "WIK-235" — el UUID que devuelve el picker)
//   <target-state>  nombre EXACTO del state (ej "In Review") o, como
//                   fallback, un `type` de Linear (triage, backlog,
//                   unstarted, started, completed, canceled).
//
// Resolución del state destino:
//   1. Match por NOMBRE exacto (case-insensitive). Preferido porque el
//      team de Tero tiene DOS states type=started ("In Review" y "In
//      Progress") — matchear solo por type podría agarrar el equivocado.
//   2. Si no hay match por nombre, fallback a match por TYPE (primero
//      por `position`).
//
// Idempotencia: si el ticket ya está en el state destino (o, para el
// fallback por type, en cualquier state de ese type), no hace nada.
//
// Best-effort: cualquier error se loguea pero sale 0 igual — NO queremos
// que un fallo al mover el ticket reviente el run del worker (el PR ya
// está abierto, que es lo importante).
//
// Requiere: LINEAR_API_TOKEN env var.

const TOKEN = process.env.LINEAR_API_TOKEN;
const [, , TICKET_UUID, TARGET_STATE] = process.argv;

if (!TOKEN) {
  console.error("[move-ticket] LINEAR_API_TOKEN not set — skipping.");
  process.exit(0);
}
if (!TICKET_UUID || !TARGET_STATE) {
  console.error(
    "[move-ticket] usage: move-ticket-state.mjs <ticket-uuid> <target-state>",
  );
  process.exit(0);
}

const ENDPOINT = "https://api.linear.app/graphql";

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Linear HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(
      `Linear errors: ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }
  return json.data;
}

async function main() {
  // 1. Fetch el issue: su state actual + el team (con todos sus states).
  const data = await gql(
    `query IssueStates($id: String!) {
      issue(id: $id) {
        id
        identifier
        state { id name type }
        team {
          states {
            nodes { id name type position }
          }
        }
      }
    }`,
    { id: TICKET_UUID },
  );

  const issue = data.issue;
  if (!issue) {
    console.error(`[move-ticket] issue ${TICKET_UUID} no encontrado — skip.`);
    return;
  }

  const states = issue.team?.states?.nodes ?? [];
  const wanted = TARGET_STATE.toLowerCase();

  // Resolver el state destino: primero por NOMBRE exacto (case-insensitive),
  // después fallback por TYPE (primero por position).
  let target = states.find((s) => s.name.toLowerCase() === wanted);
  let matchedBy = "name";
  if (!target) {
    const byType = states
      .filter((s) => s.type === wanted)
      .sort((a, b) => a.position - b.position);
    target = byType[0];
    matchedBy = "type";
  }

  if (!target) {
    console.error(
      `[move-ticket] el team de ${issue.identifier} no tiene un state con nombre/type "${TARGET_STATE}" — skip.`,
    );
    return;
  }

  // Idempotencia: si ya está en el state destino, no hacer nada.
  if (issue.state?.id === target.id) {
    console.log(
      `[move-ticket] ${issue.identifier} ya está en "${target.name}" — no-op.`,
    );
    return;
  }
  console.log(
    `[move-ticket] target resuelto por ${matchedBy}: "${target.name}" (type=${target.type}).`,
  );

  // 4. Mover.
  await gql(
    `mutation Move($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
      }
    }`,
    { id: TICKET_UUID, stateId: target.id },
  );

  console.log(
    `[move-ticket] ${issue.identifier}: "${issue.state?.name}" → "${target.name}" (type=${target.type}).`,
  );
}

main().catch((e) => {
  // Best-effort: loguear pero no fallar el run.
  console.error(`[move-ticket] error (no-fatal): ${e.message}`);
  process.exit(0);
});
