import "server-only";
import { tuyaFetch } from "./client";

/**
 * Tap-to-Run scenes (también llamadas "linkage rules" tipo scene) en
 * la API v2.0 de Tuya. WIK-103.
 *
 * Docs:
 *   - List:    GET  /v2.0/cloud/scene/rule?space_id={home}&type=scene
 *   - Trigger: POST /v2.0/cloud/scene/rule/{rule_id}/actions/trigger
 *
 * Cada Tuya home es un `space_id` separado. Para listar todos los
 * scenes del cloud project, hay que iterar sobre los homes — eso lo
 * hace `listAllTapToRunScenes()`.
 */

export type TapToRunScene = {
  id: string;
  name: string;
  /** ID del Tuya home dueño del scene (para mostrar agrupado). */
  home_id: string;
  /** Estado on/off (algunos scenes están "deshabilitados" en la app). */
  status: boolean;
  /** Iconos / metadata opcional que viene del cloud. */
  background?: string;
  cover_icon?: string;
};

type TuyaSceneListResponse = {
  list?: Array<{
    id: string;
    name: string;
    enabled?: boolean;
    status?: boolean;
    background?: string;
    cover_icon?: string;
    type?: string;
  }>;
  // En algunas variantes el array viene en `data` directamente.
  data?: Array<{
    id: string;
    name: string;
    enabled?: boolean;
    status?: boolean;
    background?: string;
    cover_icon?: string;
    type?: string;
  }>;
};

/**
 * Lista los scenes de un home Tuya específico. Filtramos por
 * `type=scene` (tap-to-run) — las "automation" rules tienen condición
 * de trigger automático y no las exponemos en este UI.
 */
export async function listScenesForHome(
  homeId: string | number,
): Promise<TapToRunScene[]> {
  const r = await tuyaFetch<TuyaSceneListResponse>(
    "GET",
    `/v2.0/cloud/scene/rule?space_id=${homeId}&type=scene`,
  );
  const rows = r.list ?? r.data ?? [];
  return rows.map((s) => ({
    id: String(s.id),
    name: String(s.name ?? "(sin nombre)"),
    home_id: String(homeId),
    status: s.status ?? s.enabled ?? true,
    background: s.background,
    cover_icon: s.cover_icon,
  }));
}

/**
 * Ejecuta un tap-to-run scene en el cloud. Tuya devuelve `success`
 * boolean — convertimos a error si es false.
 */
export async function triggerScene(sceneId: string): Promise<void> {
  type TriggerResponse = { success?: boolean };
  const r = await tuyaFetch<TriggerResponse>(
    "POST",
    `/v2.0/cloud/scene/rule/${sceneId}/actions/trigger`,
  );
  // Algunos endpoints v2 devuelven `{}` exitoso sin `success`. Solo
  // fallamos si viene explícitamente false.
  if (r && r.success === false) {
    throw new Error("Tuya rechazó la ejecución del scene.");
  }
}
