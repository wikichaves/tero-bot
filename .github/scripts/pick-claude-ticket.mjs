#!/usr/bin/env node
// Pick the next Linear ticket for the autonomous Claude worker (WIK-97).
//
// WIK-266 Fase 2 (worker centralizado): el worker ya no es exclusivo de
// tero-bot. Toma el siguiente ticket autonomous de CUALQUIER project que
// esté en el registry (.github/claude-repos.json) y devuelve su `project`
// para que el workflow clone el repo correcto. Tickets de projects
// desconocidos se ignoran (no hay repo donde trabajarlos).
//
// Strategy:
//   1. If FORCED_TICKET env var set (workflow_dispatch input), fetch that
//      specific ticket. Se procesa solo si su project está en el registry.
//   2. Otherwise: tickets con label "claude:autonomous" en estado Todo
//      (type "unstarted"), de projects conocidos, ordenados por priority
//      asc (1=urgent primero) y createdAt asc. Tomar el primero.
//
// Output: JSON a stdout con { id, identifier, title, description, project }
// o { identifier: null } si no matchea ningún ticket.
//
// Requires: LINEAR_API_TOKEN env var.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.LINEAR_API_TOKEN;
const FORCED = (process.env.FORCED_TICKET ?? "").trim();
if (!TOKEN) {
  console.error("LINEAR_API_TOKEN not set");
  process.exit(1);
}

// Registry de projects conocidos (Linear project name -> repo config). El
// worker solo procesa tickets cuyo project esté acá; el resto se ignora.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(resolve(__dirname, "../claude-repos.json"), "utf8"),
);
const KNOWN_PROJECTS = new Set(
  Object.keys(REGISTRY).filter((k) => k !== "_comment"),
);

const ENDPOINT = "https://api.linear.app/graphql";

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Linear errors: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  return json.data;
}

async function fetchByIdentifier(identifier) {
  const data = await gql(
    `query ByIdent($id: String!) {
      issue(id: $id) {
        id identifier title description
        state { name }
        project { name }
      }
    }`,
    { id: identifier },
  );
  return data.issue ?? null;
}

async function fetchTopAutonomous() {
  // Filter by label name + state type "unstarted" (Todo). Backlog NO
  // se incluye a propósito: doble approval gate — primero el label
  // `claude:autonomous` (= "candidato"), después moverlo a Todo (= "go").
  // WIK-266: SIN filtro por project — el worker centralizado resuelve el
  // repo a partir del project del ticket. Filtramos client-side a los
  // projects conocidos del registry.
  const data = await gql(
    `query Pick {
      issues(
        filter: {
          labels: { name: { eq: "claude:autonomous" } }
          state: { type: { eq: "unstarted" } }
        }
        orderBy: createdAt
        first: 50
      ) {
        nodes {
          id identifier title description
          priority
          state { name type }
          project { name }
        }
      }
    }`,
    {},
  );
  const all = (data.issues?.nodes ?? []).filter((n) =>
    KNOWN_PROJECTS.has(n.project?.name ?? ""),
  );
  if (all.length === 0) return null;
  // Sort: priority asc, but treat 0 (no priority) as last (Infinity).
  all.sort((a, b) => {
    const pa = a.priority === 0 ? Infinity : a.priority;
    const pb = b.priority === 0 ? Infinity : b.priority;
    return pa - pb;
  });
  return all[0];
}

async function main() {
  let issue;
  if (FORCED) {
    issue = await fetchByIdentifier(FORCED);
    if (!issue) {
      console.error(`Forced ticket ${FORCED} not found`);
      process.stdout.write(JSON.stringify({ identifier: null }));
      return;
    }
    // WIK-266: el project del ticket forzado debe estar en el registry —
    // si no, no hay repo donde trabajarlo.
    const proj = issue.project?.name ?? "(sin project)";
    if (!KNOWN_PROJECTS.has(proj)) {
      console.error(
        `Forced ticket ${FORCED} pertenece al project "${proj}", que no está ` +
          `en .github/claude-repos.json. No hay repo target — se ignora.`,
      );
      process.stdout.write(JSON.stringify({ identifier: null }));
      return;
    }
  } else {
    issue = await fetchTopAutonomous();
    if (!issue) {
      process.stdout.write(JSON.stringify({ identifier: null }));
      return;
    }
  }
  process.stdout.write(
    JSON.stringify({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      project: issue.project?.name ?? "",
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
