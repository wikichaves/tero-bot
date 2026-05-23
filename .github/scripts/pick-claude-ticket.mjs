#!/usr/bin/env node
// Pick the next Linear ticket for the autonomous Claude worker (WIK-97).
//
// Strategy:
//   1. If FORCED_TICKET env var set (workflow_dispatch input), fetch
//      that specific ticket regardless of label/state.
//   2. Otherwise, find tickets with label "claude:autonomous" in state
//      "Todo", ordered by priority asc (1=urgent first), then
//      createdAt asc. Take the first one.
//
// Output: JSON to stdout with { id, identifier, title, description }
// or { identifier: null } if no ticket matches.
//
// Requires:
//   LINEAR_API_TOKEN env var.

const TOKEN = process.env.LINEAR_API_TOKEN;
const FORCED = (process.env.FORCED_TICKET ?? "").trim();
if (!TOKEN) {
  console.error("LINEAR_API_TOKEN not set");
  process.exit(1);
}

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
      }
    }`,
    { id: identifier },
  );
  return data.issue ?? null;
}

async function fetchTopAutonomous() {
  // Filter by label name + state type in ["unstarted" (Todo), "backlog"].
  // El label `claude:autonomous` ya es el approval gate — no es necesario
  // forzar que el user también mueva el ticket a Todo (Linear pone tickets
  // nuevos en Backlog por default, sería fricción inútil).
  const data = await gql(
    `query Pick {
      issues(
        filter: {
          labels: { name: { eq: "claude:autonomous" } }
          state: { type: { in: ["unstarted", "backlog"] } }
        }
        orderBy: createdAt
        first: 20
      ) {
        nodes {
          id identifier title description
          priority
          state { name type }
        }
      }
    }`,
    {},
  );
  const all = data.issues?.nodes ?? [];
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
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
