import "server-only";
import { tuyaFetch } from "./client";

/**
 * Smart-lock helpers.
 *
 * Tuya supports two flows for temp passwords on door locks:
 *
 *   1. **Offline temp password** — Tuya's cloud generates the code server-side
 *      using a deterministic hash + the lock's seed. The code works even if
 *      the lock is temporarily offline at the moment of use, as long as the
 *      lock has been activated before. No client-side encryption needed.
 *      Endpoints: `/v1.0/devices/{id}/door-lock/offline/temp-passwords` (newer)
 *      or `/v1.0/smart-lock/devices/{id}/password-offline-time` (older alias).
 *
 *   2. **Online temp password** — admin generates the code, encrypts it with
 *      a per-request "ticket key" (AES-128-ECB), and sends it. The lock
 *      receives the password via cloud. Requires the lock to be online when
 *      the code is set. More complex (encryption flow), kept as future
 *      fallback if a particular lock model rejects the offline flow.
 *
 * We start with offline only; if a lock model rejects it we'll add the
 * encrypted online flow as fallback.
 *
 * Tuya docs:
 *   https://developer.tuya.com/en/docs/cloud/temporary-password
 *   https://developer.tuya.com/en/docs/cloud/offline-password
 */

export type LockTempPasswordCreated = {
  id: string;
  password: string;
  effective_time: number;
  invalid_time: number;
};

export type LockTempPassword = {
  id: string;
  name: string | null;
  effective_time: number;
  invalid_time: number;
  phase?: number;
  status?: string;
};

type CreateOfflineResponse = {
  id?: string | number;
  password_id?: string | number;
  multiple_password_id?: string | number;
  password?: string;
  effective_time?: number;
  invalid_time?: number;
};

type ListOfflineResponse =
  | LockTempPassword[]
  | { list?: LockTempPassword[]; passwords?: LockTempPassword[] }
  | null;

function asString(v: string | number | undefined): string {
  return v == null ? "" : String(v);
}

/**
 * Create an offline temp password on the given lock.
 *
 * Tuya validates that:
 *   - effective_time < invalid_time
 *   - both are unix-seconds (NOT milliseconds)
 *   - duration is within the lock's allowed window (commonly up to 6 months)
 *
 * Returns the generated 7-digit code AND its password_id (used for revocation).
 */
export async function addOfflineTempPassword(
  deviceId: string,
  opts: {
    name: string;
    effective_time: number;
    invalid_time: number;
    /** Some endpoints accept a phone for SMS delivery; we don't use it. */
    phone?: string;
  },
): Promise<LockTempPasswordCreated> {
  if (!Number.isFinite(opts.effective_time) || !Number.isFinite(opts.invalid_time)) {
    throw new Error("effective_time and invalid_time must be unix seconds.");
  }
  if (opts.effective_time >= opts.invalid_time) {
    throw new Error("effective_time must be before invalid_time.");
  }
  if (opts.effective_time > 1e12 || opts.invalid_time > 1e12) {
    throw new Error(
      "Times look like milliseconds — Tuya expects unix seconds.",
    );
  }

  const body = {
    name: opts.name.slice(0, 50),
    effective_time: opts.effective_time,
    invalid_time: opts.invalid_time,
    ...(opts.phone ? { phone: opts.phone } : {}),
  };

  let lastError: unknown;
  for (const path of [
    `/v1.0/devices/${deviceId}/door-lock/offline/temp-passwords`,
    `/v1.0/smart-lock/devices/${deviceId}/password-offline-time`,
  ]) {
    try {
      const r = await tuyaFetch<CreateOfflineResponse>("POST", path, { body });
      const id = asString(r.id ?? r.password_id ?? r.multiple_password_id);
      const password = asString(r.password);
      if (!id || !password) {
        throw new Error(
          `Tuya replied without password/id (path: ${path}). Body: ${JSON.stringify(r)}`,
        );
      }
      return {
        id,
        password,
        effective_time: r.effective_time ?? opts.effective_time,
        invalid_time: r.invalid_time ?? opts.invalid_time,
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `addOfflineTempPassword failed on all known endpoints: ${(lastError as Error)?.message ?? "unknown"}`,
  );
}

/**
 * List offline temp passwords currently on the lock.
 * Tries the v1.0 endpoint first, falls back to the smart-lock alias.
 */
export async function listOfflineTempPasswords(
  deviceId: string,
): Promise<LockTempPassword[]> {
  let lastError: unknown;
  for (const path of [
    `/v1.0/devices/${deviceId}/door-lock/offline/temp-passwords`,
    `/v1.0/smart-lock/devices/${deviceId}/password-offline-time`,
  ]) {
    try {
      const r = await tuyaFetch<ListOfflineResponse>("GET", path);
      if (Array.isArray(r)) return r;
      if (r && typeof r === "object") {
        return r.list ?? r.passwords ?? [];
      }
      return [];
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `listOfflineTempPasswords failed: ${(lastError as Error)?.message ?? "unknown"}`,
  );
}

/**
 * Revoke a temp password by its id.
 */
export async function deleteOfflineTempPassword(
  deviceId: string,
  passwordId: string,
): Promise<void> {
  let lastError: unknown;
  for (const path of [
    `/v1.0/devices/${deviceId}/door-lock/offline/temp-passwords/${passwordId}`,
    `/v1.0/smart-lock/devices/${deviceId}/password-offline-time/${passwordId}`,
  ]) {
    try {
      await tuyaFetch("DELETE", path);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `deleteOfflineTempPassword failed: ${(lastError as Error)?.message ?? "unknown"}`,
  );
}

/**
 * Convenience: a temp password is "active" when it's still within its
 * effective window (Tuya doesn't always set `status`, so we compute it).
 */
export function isLockPasswordActive(
  password: LockTempPassword,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  return now >= password.effective_time && now < password.invalid_time;
}
