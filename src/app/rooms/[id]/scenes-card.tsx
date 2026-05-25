import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { listDevicesGroupedByHome } from "@/lib/tuya/devices";
import {
  getSceneDetail,
  listScenesForHome,
  type TapToRunScene,
} from "@/lib/tuya/scenes";
import { mapWithConcurrency } from "@/lib/util/concurrent";
import { RunSceneButton } from "./run-scene-button";

/**
 * Card de tap-to-run scenes filtradas por relevancia a un room (WIK-172).
 *
 * Lógica:
 *   1. Tomar los Tuya device IDs de devices asignados al `room_id`
 *      actual (any device kind, no solo sensors).
 *   2. Listar TODAS las scenes del cloud project, agrupadas por home.
 *   3. Para cada scene, fetch del detalle (actions[].entity_id) en
 *      paralelo (concurrency 3, ver `src/lib/util/concurrent.ts`).
 *   4. Filtrar a scenes con al menos un device action cuyo `entity_id`
 *      coincida con un device de este room.
 *
 * Si el room no tiene devices o ninguna scene matchea, devolvemos
 * null — la card no se renderiza. Los errores parciales (un home
 * falla en fetch) se loguean y se siguen mostrando las scenes que
 * sí se pudieron resolver.
 *
 * Renderiza solo para admin — la `runScene` server action ya tiene
 * `requireRole(["admin"])`, pero ocultamos UI a no-admin para que
 * no vea botones que no puede tocar.
 */
export async function ScenesCard({
  roomId,
  isAdmin,
}: {
  roomId: string;
  isAdmin: boolean;
}) {
  if (!isAdmin) return null;

  const admin = createAdminClient();
  const t = await getTranslations("roomDetail.scenes");

  // 1. Devices del room (sin filtro de kind — un AC switch no es
  //    sensor pero importa para matchear scenes).
  const { data: roomDevices } = await admin
    .from("property_devices")
    .select("tuya_device_id")
    .eq("room_id", roomId);
  const roomDeviceIds = new Set(
    (roomDevices ?? []).map((d) => d.tuya_device_id).filter(Boolean),
  );
  if (roomDeviceIds.size === 0) return null;

  // 2. Tuya scenes de todos los homes.
  let scenes: TapToRunScene[] = [];
  try {
    const grouped = await listDevicesGroupedByHome();
    const perHome = await Promise.all(
      grouped.homes.map(async ({ home }) => {
        try {
          return await listScenesForHome(home.home_id);
        } catch (e) {
          console.warn(
            `[room-scenes] listScenesForHome(${home.home_id}) failed: ${(e as Error).message}`,
          );
          return [] as TapToRunScene[];
        }
      }),
    );
    scenes = perHome.flat().filter((s) => s.status);
  } catch (e) {
    console.warn(
      `[room-scenes] listDevicesGroupedByHome failed: ${(e as Error).message}`,
    );
    return null;
  }
  if (scenes.length === 0) return null;

  // 3. Detalles en paralelo con concurrency cap (WIK-161 v2) para no
  //    golpear el rate limit de Tuya.
  const details = await mapWithConcurrency(
    scenes,
    async (s) => {
      try {
        return await getSceneDetail(s.id);
      } catch (e) {
        console.warn(
          `[room-scenes] getSceneDetail(${s.id}) failed: ${(e as Error).message}`,
        );
        return null;
      }
    },
    3,
  );

  // 4. Filtrar scenes que tocan al menos 1 device de este room.
  const matching = scenes.flatMap((scene, i) => {
    const detail = details[i];
    if (!detail) return [];
    const overlaps = detail.device_ids.some((id) => roomDeviceIds.has(id));
    return overlaps ? [{ scene, detail }] : [];
  });
  if (matching.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {matching.map(({ scene }) => (
          <RunSceneButton
            key={scene.id}
            sceneId={scene.id}
            sceneName={scene.name}
          />
        ))}
      </CardContent>
    </Card>
  );
}
