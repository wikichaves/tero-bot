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

const SCHEMAS = ["smartlife", "tuyaSmart", "SmartLife"];

/**
 * List app users (UIDs) linked to the Cloud Project. Tuya exposes several
 * endpoints depending on the auth product and they've changed over time —
 * we try the newer ones first and fall back to the older /apps/{schema}/users
 * shape. If TUYA_USER_UID is set in env, we short-circuit and use it directly,
 * which lets you skip user-discovery altogether.
 */
export async function listAppUsers(): Promise<TuyaAppUser[]> {
  const fallbackUid = process.env.TUYA_USER_UID?.trim();
  if (fallbackUid) {
    return [{ uid: fallbackUid, username: "(from TUYA_USER_UID env)" }];
  }

  // 1. Newer Cloud-Project-scoped endpoint (works with most current setups)
  try {
    const r = await tuyaFetch<
      | TuyaAppUser[]
      | { list?: TuyaAppUser[]; users?: TuyaAppUser[] }
    >("GET", "/v1.0/iot-01/associated-users/users", {
      query: { page_no: 1, page_size: 50 },
    });
    const users = Array.isArray(r) ? r : (r?.list ?? r?.users ?? []);
    if (users.length > 0) return users;
  } catch {
    /* fall through */
  }

  // 2. Older schema-based endpoints (smartlife / tuyaSmart)
  for (const schema of SCHEMAS) {
    try {
      const r = await tuyaFetch<
        TuyaAppUser[] | { list?: TuyaAppUser[]; users?: TuyaAppUser[] }
      >("GET", `/v1.0/apps/${schema}/users`, {
        query: { page_no: 1, page_size: 50 },
      });
      const users = Array.isArray(r) ? r : (r?.list ?? r?.users ?? []);
      if (users.length > 0) return users;
    } catch {
      /* try next schema */
    }
  }

  return [];
}

/**
 * List devices linked to a specific Tuya app user (by UID). Different
 * endpoints work depending on subscriptions and Tuya version — try the
 * modern IoT-03 one first, then the Cloud Thing API, then the legacy one.
 */
export async function listDevicesByUser(uid: string): Promise<TuyaDevice[]> {
  const errors: string[] = [];

  // 1. IoT-03 (modern, requires IoT Core subscription — which we have)
  try {
    const r = await tuyaFetch<{ list?: TuyaDevice[] } | TuyaDevice[]>(
      "GET",
      "/v1.3/iot-03/devices",
      { query: { source_type: "tuyaUser", source_id: uid, page_size: 100 } },
    );
    const list = Array.isArray(r) ? r : (r?.list ?? []);
    if (list.length > 0) return list;
  } catch (e) {
    errors.push(`iot-03: ${(e as Error).message}`);
  }

  // 2. Cloud Thing API (v2.0)
  try {
    const r = await tuyaFetch<{ list?: TuyaDevice[] } | TuyaDevice[]>(
      "GET",
      "/v2.0/cloud/thing/device",
      { query: { source_type: "tuyaUser", source_id: uid, page_size: 100 } },
    );
    const list = Array.isArray(r) ? r : (r?.list ?? []);
    if (list.length > 0) return list;
  } catch (e) {
    errors.push(`v2.0/cloud/thing: ${(e as Error).message}`);
  }

  // 3. Legacy Smart Home endpoint
  try {
    const r = await tuyaFetch<TuyaDevice[] | { list?: TuyaDevice[] }>(
      "GET",
      `/v1.0/users/${uid}/devices`,
    );
    const list = Array.isArray(r) ? r : (r?.list ?? []);
    if (list.length > 0) return list;
  } catch (e) {
    errors.push(`v1.0/users/{uid}/devices: ${(e as Error).message}`);
  }

  if (errors.length === 3) {
    throw new Error(
      `All device-list endpoints failed. Try copying the UID exactly from the Tuya cloud (Devices → Link App Account, UID column — beware of line wrapping). Errors:\n${errors.join("\n")}`,
    );
  }
  return [];
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

export type TuyaHome = {
  home_id: number | string;
  name: string;
  geo_name?: string;
  admin?: boolean;
  role?: number;
};

/** List all Smart Life "homes" the user belongs to. */
export async function listUserHomes(uid: string): Promise<TuyaHome[]> {
  const r = await tuyaFetch<
    TuyaHome[] | { homes?: TuyaHome[]; list?: TuyaHome[] }
  >("GET", `/v1.0/users/${uid}/homes`);
  if (Array.isArray(r)) return r;
  return r?.homes ?? r?.list ?? [];
}

/** List devices in a specific home. */
export async function listDevicesForHome(
  homeId: string | number,
): Promise<TuyaDevice[]> {
  const r = await tuyaFetch<
    TuyaDevice[] | { devices?: TuyaDevice[]; list?: TuyaDevice[] }
  >("GET", `/v1.0/homes/${homeId}/devices`);
  if (Array.isArray(r)) return r;
  return r?.devices ?? r?.list ?? [];
}

/**
 * High-level: pull every home for the linked Smart Life user and the
 * devices in each. Returns `null` for `user` if no app account is linked.
 *
 * Rather than a single flat device list, this preserves the home grouping
 * — useful for bulk-assigning all devices in a home to a property.
 */
export async function listDevicesGroupedByHome(): Promise<{
  user: TuyaAppUser | null;
  homes: Array<{ home: TuyaHome; devices: TuyaDevice[] }>;
}> {
  const users = await listAppUsers();
  if (users.length === 0) return { user: null, homes: [] };
  const user = users[0];

  const homes = await listUserHomes(user.uid);
  const homeGroups = await Promise.all(
    homes.map(async (home) => {
      try {
        const devices = await listDevicesForHome(home.home_id);
        return { home, devices };
      } catch (e) {
        console.warn(
          `[listDevicesGroupedByHome] home ${home.home_id} failed:`,
          (e as Error).message,
        );
        return { home, devices: [] as TuyaDevice[] };
      }
    }),
  );

  return { user, homes: homeGroups };
}
