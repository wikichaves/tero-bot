import "server-only";
import crypto from "node:crypto";

/**
 * Tuya Open API client — server-only.
 *
 * Tuya uses a custom HMAC-SHA256 signing scheme. Each request signs:
 *   stringToSign = HTTPMethod + "\n" + sha256(body) + "\n" + headers + "\n" + url
 *   signString  = clientId [+ accessToken] + t + nonce + stringToSign
 *   sign        = HMAC_SHA256(signString, accessSecret).toUpperCase()
 *
 * The token endpoint omits accessToken from signString; everything else
 * includes it. We cache the token in-memory for the life of the lambda.
 *
 * Docs: https://developer.tuya.com/en/docs/cloud/cb51f82918?id=Kavfo9k4n9zfn
 */

const REGIONS = {
  us: "https://openapi.tuyaus.com",
  eu: "https://openapi.tuyaeu.com",
  cn: "https://openapi.tuyacn.com",
  in: "https://openapi.tuyain.com",
} as const;

type Region = keyof typeof REGIONS;

function getConfig() {
  const id = process.env.TUYA_ACCESS_ID;
  const secret = process.env.TUYA_ACCESS_SECRET;
  const region = (process.env.TUYA_REGION ?? "us") as Region;
  if (!id || !secret) {
    throw new Error(
      "Missing Tuya env vars (TUYA_ACCESS_ID, TUYA_ACCESS_SECRET).",
    );
  }
  if (!REGIONS[region]) {
    throw new Error(
      `Invalid TUYA_REGION: "${region}". Must be one of ${Object.keys(REGIONS).join(", ")}.`,
    );
  }
  return { id, secret, baseUrl: REGIONS[region] };
}

const EMPTY_BODY_HASH = sha256("");

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function hmac(message: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex")
    .toUpperCase();
}

function buildStringToSign(
  method: string,
  body: string,
  path: string,
  queryString: string,
): string {
  const url = queryString ? `${path}?${queryString}` : path;
  const contentHash = body ? sha256(body) : EMPTY_BODY_HASH;
  // Headers slot is empty — we don't sign any custom headers.
  return `${method.toUpperCase()}\n${contentHash}\n\n${url}`;
}

/**
 * Sorted [key, value] query entries (ASCII order by key), with null/undefined
 * dropped. Tuya's signature and the actual request URL need DIFFERENT encodings
 * of these (see `tuyaFetch`), so we return the raw pairs and let the caller
 * build each string.
 */
function sortedQueryEntries(
  params: Record<string, unknown> | undefined,
): Array<readonly [string, string]> {
  if (!params) return [];
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

type TuyaResponse<T> = {
  success: boolean;
  result?: T;
  msg?: string;
  code?: number | string;
  t?: number;
};

async function fetchAccessToken(): Promise<TokenCache> {
  const { id, secret, baseUrl } = getConfig();
  const t = Date.now().toString();
  const path = "/v1.0/token";
  const queryString = "grant_type=1";
  const stringToSign = buildStringToSign("GET", "", path, queryString);
  const signStr = id + t + stringToSign;
  const sign = hmac(signStr, secret);

  const res = await fetch(`${baseUrl}${path}?${queryString}`, {
    method: "GET",
    headers: {
      client_id: id,
      sign,
      t,
      sign_method: "HMAC-SHA256",
    },
    cache: "no-store",
  });
  const data = (await res.json()) as TuyaResponse<{
    access_token: string;
    expire_time: number;
    refresh_token: string;
    uid: string;
  }>;
  if (!data.success || !data.result) {
    throw new Error(
      `Tuya token request failed: ${data.msg ?? data.code ?? "unknown"}`,
    );
  }
  return {
    token: data.result.access_token,
    // expire_time is in seconds; subtract 60s of safety margin
    expiresAt: Date.now() + (data.result.expire_time - 60) * 1000,
  };
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  tokenCache = await fetchAccessToken();
  return tokenCache.token;
}

export type TuyaFetchOptions = {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
};

/**
 * Make a signed Tuya Open API call. Returns the `result` field of a
 * successful response, or throws with the API error message.
 */
export async function tuyaFetch<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: TuyaFetchOptions = {},
): Promise<T> {
  const { id, secret, baseUrl } = getConfig();
  const accessToken = await getAccessToken();
  const t = Date.now().toString();

  const entries = sortedQueryEntries(options.query);
  // Tuya signs over the RAW (un-encoded) "key=value" pairs, but the actual
  // HTTP request must URL-encode the values. Signing the encoded form breaks
  // for values with reserved chars (e.g. the base64 `start_row_key` used in
  // pagination, which can contain `=`/`+`/`/`) → "sign invalid".
  const signQueryString = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const urlQueryString = entries
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const bodyStr = options.body ? JSON.stringify(options.body) : "";

  const stringToSign = buildStringToSign(method, bodyStr, path, signQueryString);
  const signStr = id + accessToken + t + stringToSign;
  const sign = hmac(signStr, secret);

  const url = urlQueryString
    ? `${baseUrl}${path}?${urlQueryString}`
    : `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      client_id: id,
      sign,
      t,
      sign_method: "HMAC-SHA256",
      access_token: accessToken,
      "Content-Type": "application/json",
    },
    body: bodyStr || undefined,
    cache: "no-store",
  });
  const data = (await res.json()) as TuyaResponse<T>;
  if (!data.success) {
    throw new Error(
      `Tuya API error (${method} ${path}): ${data.msg ?? data.code ?? "unknown"}`,
    );
  }
  return data.result as T;
}

/**
 * Test helper: triggers a token fetch and returns true on success.
 * Useful as a connectivity check from an admin panel.
 */
export async function tuyaPing(): Promise<{ ok: true; expiresAt: number }> {
  const { token: _token, expiresAt } = await fetchAccessToken();
  tokenCache = { token: _token, expiresAt };
  return { ok: true, expiresAt };
}
