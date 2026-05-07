import "server-only";
import { tuyaFetch } from "./client";

/**
 * Smart-lock helpers — offline temporary password flow.
 *
 * Tuya's official docs: https://developer.tuya.com/en/docs/cloud/009bdf7768
 *
 * The endpoint is `POST /v1.1/devices/{device_id}/door-lock/offline-temp-password`
 * and a single endpoint handles all operations via the `type` field:
 *   - `multiple`  → create a multi-use temp password (what we want for guests)
 *   - `once`      → create a single-use one
 *   - `clear_one` → revoke one (requires `password_id`)
 *   - `clear_all` → revoke all
 *
 * There is NO separate GET endpoint to list active offline temp passwords —
 * Tuya only returns the password at creation time. To track active codes we
 * need to persist them in our own DB (future iteration). For now the UI only
 * remembers codes generated in the current session.
 */

export type LockTempPasswordCreated = {
  id: string;
  password: string;
  name: string;
  effective_time: number;
  invalid_time: number;
};

type CreateOfflineResponse = {
  offline_temp_password_id?: string | number;
  offline_temp_password?: string;
  offline_temp_password_name?: string;
  effective_time?: number;
  invalid_time?: number;
};

/**
 * Create a multi-use offline temp password on the given lock.
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
    type: "multiple",
  };

  const r = await tuyaFetch<CreateOfflineResponse>(
    "POST",
    `/v1.1/devices/${deviceId}/door-lock/offline-temp-password`,
    { body },
  );

  const id = r.offline_temp_password_id ? String(r.offline_temp_password_id) : "";
  const password = r.offline_temp_password ?? "";

  if (!id || !password) {
    throw new Error(
      `Tuya replied without password/id. Body: ${JSON.stringify(r)}`,
    );
  }

  return {
    id,
    password,
    name: r.offline_temp_password_name ?? opts.name,
    effective_time: r.effective_time ?? opts.effective_time,
    invalid_time: r.invalid_time ?? opts.invalid_time,
  };
}

/**
 * Revoke a temp password by its id. Uses the same endpoint as create with
 * type=clear_one and password_id.
 */
export async function deleteOfflineTempPassword(
  deviceId: string,
  passwordId: string,
): Promise<void> {
  await tuyaFetch(
    "POST",
    `/v1.1/devices/${deviceId}/door-lock/offline-temp-password`,
    {
      body: {
        type: "clear_one",
        password_id: passwordId,
      },
    },
  );
}

/**
 * Revoke ALL offline temp passwords on the lock. Useful if we lose track of
 * password_ids and want to start clean.
 */
export async function clearAllOfflineTempPasswords(
  deviceId: string,
): Promise<void> {
  await tuyaFetch(
    "POST",
    `/v1.1/devices/${deviceId}/door-lock/offline-temp-password`,
    {
      body: { type: "clear_all" },
    },
  );
}
