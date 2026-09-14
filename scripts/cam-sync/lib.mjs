// Shared helpers for tero-cam-sync.
// Signs a short-lived Home Assistant access token from the local auth store,
// so we can bootstrap without any password. No external deps.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

// QEMU publishes Home Assistant Core (guest :80) on localhost:8123.
export const HA_URL = process.env.HA_URL || "http://127.0.0.1:8123";
const AUTH_STORE = process.env.HA_AUTH_STORE || "/Users/wikichaves/homeassistant/.storage/auth";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Build a HS256 JWT HA will accept as an access token for the given refresh token.
export function signHaAccessToken(ttlSeconds = 300) {
  const store = JSON.parse(readFileSync(AUTH_STORE, "utf8"));
  const tokens = store.data.refresh_tokens || [];
  const rt = tokens.find((t) => t.token_type === "normal") || tokens[0];
  if (!rt) throw new Error("no refresh token found in HA auth store");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: rt.id, iat: now, exp: now + ttlSeconds }));
  const sig = b64url(createHmac("sha256", rt.jwt_key).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
