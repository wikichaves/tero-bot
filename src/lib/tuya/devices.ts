import "server-only";
import { tuyaFetch } from "./client";

/**
 * Tuya device models — minimal subset of fields we currently use. Tuya returns
 * a lot more; we keep this loose to avoid over-coupling to an external schema.
 */
export type TuyaDevice = {
  id: string;
  uuid?: string;
  name: string;
  product_id?: string;
  product_name?: string;
  category?: string;
  category_name?: string;
  online: boolean;
  ip?: string;
  time_zone?: string;
  active_time?: number;
  create_time?: number;
  update_time?: number;
  icon?: string;
  sub?: boolean;
};

export type TuyaAppUser = {
  uid: string;
  username?: string;
  email?: string;
  mobile?: string;
  country_code?: string;
  nick_name?: string;
  create_time?: number;
};

const DEFAULT_SCHEMAS = ["smartlife", "tuyaSmart"];

/**
 * List app users (UIDs) linked to the Cloud Project. Tries the common app
 * "schemas" until one returns at least one user.
 */
export async function listAppUsers(): Promise<TuyaAppUser[]> {
  for (const schema of DEFAULT_SCHEMAS) {
    try {
      const result = await tuyaFetch<TuyaAppUser[] | { list: TuyaAppUser[] }>(
        "GET",
        `/v1.0/apps/${schema}/users`,
        { query: { page_no: 1, page_size: 50 } },
      );
      const users = Array.isArray(result) ? result : (result?.list ?? []);
      if (users.length > 0) return users;
    } catch {
      // try next schema
    }
  }
  return [];
}

/**
 * List devices linked to a specific Tuya app user (by UID).
 */
export async function listDevicesByUser(uid: string): Promise<TuyaDevice[]> {
  const result = await tuyaFetch<TuyaDevice[] | { list: TuyaDevice[] }>(
    "GET",
    `/v1.0/users/${uid}/devices`,
  );
  return Array.isArray(result) ? result : (result?.list ?? []);
}

/**
 * Convenience: pull the first linked user, return their devices.
 */
export async function listAllDevices(): Promise<{
  user: TuyaAppUser | null;
  devices: TuyaDevice[];
}> {
  const users = await listAppUsers();
  if (users.length === 0) return { user: null, devices: [] };
  const user = users[0];
  const devices = await listDevicesByUser(user.uid);
  return { user, devices };
}

/**
 * Get rich detail for a single device (status, online, capabilities).
 */
export async function getDevice(deviceId: string) {
  return tuyaFetch<TuyaDevice & { status?: { code: string; value: unknown }[] }>(
    "GET",
    `/v1.0/devices/${deviceId}`,
  );
}
