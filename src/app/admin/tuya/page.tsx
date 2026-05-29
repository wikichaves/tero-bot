import Link from "next/link";
import { Activity, Play } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { listDevicesGroupedByHome, type TuyaDevice } from "@/lib/tuya/devices";
import {
  listPropertyDeviceMap,
  suggestDeviceKind,
} from "@/lib/tuya/property-devices";
import { createClient } from "@/lib/supabase/server";
import { AssignDeviceButton } from "./assign-device-button";
import { BulkAssignButton } from "./bulk-assign-button";
import { HomeMappingsCard } from "./home-mappings-card";
import { SnapshotSensorsButton } from "./snapshot-sensors-button";
import { SyncRoomsButton } from "./sync-rooms-button";
import type { DeviceKind, Property, Room } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEVICE_KIND_LABEL_KEY: Record<DeviceKind, string> = {
  lock: "deviceKind.lock",
  thermostat: "deviceKind.thermostat",
  light: "deviceKind.light",
  switch: "deviceKind.switch",
  camera: "deviceKind.camera",
  sensor: "deviceKind.sensor",
  breaker: "deviceKind.breaker",
  other: "deviceKind.other",
};

export default async function TuyaPage() {
  const t = await getTranslations("adminTuyaPage");
  const result = await listDevicesGroupedByHome().catch((err: Error) => ({
    error: err.message,
  }));

  if ("error" in result) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-4xl">Tuya</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("connectionError.title")}</CardTitle>
            <CardDescription>
              {t("connectionError.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-destructive">
              {result.error}
            </pre>
            <ul className="mt-4 list-disc pl-5 text-muted-foreground">
              <li>
                {t("connectionError.envHintBefore")}{" "}
                <code>TUYA_ACCESS_ID</code>,{" "}
                <code>TUYA_ACCESS_SECRET</code>{" "}
                {t("connectionError.envHintAnd")}{" "}
                <code>TUYA_REGION</code>{" "}
                {t("connectionError.envHintAfter")}{" "}
                <code>.env.local</code>{" "}
                {t("connectionError.envHintVercel")}
              </li>
              <li>
                {t("connectionError.apisHint")}{" "}
                <em>IoT Core</em>,{" "}
                <em>Authorization Token Management</em>,{" "}
                <em>Smart Home Basic Service</em>,{" "}
                <em>Smart Lock Open Service</em>.
              </li>
              <li>
                {t("connectionError.linkHintBefore")}{" "}
                <em>Devices → Link App Account</em>.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { user, homes } = result;

  // Properties + existing assignments + rooms + home overrides in parallel.
  const supabase = await createClient();
  const [propertiesRes, deviceMap, roomsRes, overridesRes] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name")
      .order("name", { ascending: true }),
    listPropertyDeviceMap(),
    supabase
      .from("rooms")
      .select("id, name, property_id")
      .order("sort_order", { ascending: true }),
    supabase
      .from("tuya_home_overrides")
      .select("tuya_home_id, property_id"),
  ]);
  const overrides = (overridesRes.data ?? []) as Array<{
    tuya_home_id: string;
    property_id: string | null;
  }>;
  const overrideByHomeId = new Map(
    overrides.map((o) => [o.tuya_home_id, o.property_id] as const),
  );
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name"
  >[];
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const rooms = (roomsRes.data ?? []) as Pick<
    Room,
    "id" | "name" | "property_id"
  >[];
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const totalDevices = homes.reduce((acc, h) => acc + h.devices.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl">Tuya</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/tuya/scenes">
            <Button variant="outline" size="sm">
              <Play className="mr-2 h-3.5 w-3.5" />
              {t("tapToRun")}
            </Button>
          </Link>
          <Link href="/admin/tuya/diagnostico">
            <Button variant="outline" size="sm">
              <Activity className="mr-2 h-3.5 w-3.5" />
              {t("diagnostics")}
            </Button>
          </Link>
          <SyncRoomsButton />
          <SnapshotSensorsButton />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("linkedAccount.title")}</CardTitle>
          <CardDescription>
            {t("linkedAccount.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {user ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">{t("linkedAccount.username")}</dt>
              <dd>{user.username ?? user.email ?? "—"}</dd>
              <dt className="text-muted-foreground">{t("linkedAccount.uid")}</dt>
              <dd className="font-mono text-xs">{user.uid}</dd>
              {user.create_time && (
                <>
                  <dt className="text-muted-foreground">{t("linkedAccount.linkedAt")}</dt>
                  <dd>
                    {format(new Date(user.create_time * 1000), "d MMM yyyy", {
                      locale: es,
                    })}
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">{t("linkedAccount.homes")}</dt>
              <dd>
                {t("linkedAccount.homesSummary", {
                  homes: homes.length,
                  devices: totalDevices,
                })}
              </dd>
            </dl>
          ) : (
            <div className="text-muted-foreground space-y-2">
              <p>
                {t("linkedAccount.notFound")}
              </p>
              <p>
                <strong>{t("linkedAccount.workaroundLabel")}</strong>{" "}
                {t("linkedAccount.workaroundBefore")}{" "}
                <code>TUYA_USER_UID</code>.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* WIK-95: card de mapping manual home→property. Solo si hay homes. */}
      {homes.length > 0 && (
        <HomeMappingsCard
          homes={homes.map(({ home }) => {
            const homeIdStr = String(home.home_id);
            const override = overrideByHomeId.get(homeIdStr);
            const isOverride = overrideByHomeId.has(homeIdStr);
            // Auto-match por nombre (mismo algoritmo simple que el sync —
            // exact/substring case-insensitive sin tildes).
            const norm = (s: string) =>
              s
                .toLowerCase()
                .trim()
                .normalize("NFD")
                .replace(/[̀-ͯ]/g, "")
                .replace(/\s+/g, " ");
            const homeN = norm(home.name);
            const autoMatch = properties.find((p) => {
              const pn = norm(p.name);
              return pn === homeN || pn.includes(homeN) || homeN.includes(pn);
            });
            const resolved = isOverride
              ? override
                ? properties.find((p) => p.id === override) ?? null
                : null
              : (autoMatch ?? null);
            return {
              tuya_home_id: homeIdStr,
              home_name: home.name,
              current_property_id: isOverride ? override ?? null : null,
              is_override: isOverride,
              resolved_property_name: resolved?.name ?? null,
            };
          })}
          properties={properties}
        />
      )}

      {homes.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t("noHomes")}
          </CardContent>
        </Card>
      )}

      {homes.map(({ home, devices }) => (
        <HomeCard
          key={home.home_id}
          homeName={home.name}
          devices={devices}
          properties={properties}
          deviceMap={deviceMap}
          propertyById={propertyById}
          roomById={roomById}
        />
      ))}
    </div>
  );
}

async function HomeCard({
  homeName,
  devices,
  properties,
  deviceMap,
  propertyById,
  roomById,
}: {
  homeName: string;
  devices: TuyaDevice[];
  properties: Pick<Property, "id" | "name">[];
  deviceMap: Awaited<ReturnType<typeof listPropertyDeviceMap>>;
  propertyById: Map<string, Pick<Property, "id" | "name">>;
  roomById: Map<string, Pick<Room, "id" | "name" | "property_id">>;
}) {
  const t = await getTranslations("adminTuyaPage");
  // Property summary: which properties already own devices in this home?
  const assignedPropertyIds = new Set<string>();
  let unassignedCount = 0;
  for (const d of devices) {
    const pd = deviceMap.get(d.id);
    if (pd) assignedPropertyIds.add(pd.property_id);
    else unassignedCount++;
  }
  const assignedNames = Array.from(assignedPropertyIds)
    .map((id) => propertyById.get(id)?.name)
    .filter(Boolean) as string[];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("homeCard.title", { name: homeName })}</CardTitle>
            <CardDescription>
              {t("homeCard.deviceCount", { count: devices.length })}{" "}
              {assignedNames.length > 0 && (
                <>
                  {t("homeCard.assignedTo")}{" "}
                  <strong>{assignedNames.join(", ")}</strong>.
                </>
              )}{" "}
              {unassignedCount > 0 && (
                <span className="text-amber-700 dark:text-amber-300">
                  {t("homeCard.unassignedCount", { count: unassignedCount })}
                </span>
              )}
            </CardDescription>
          </div>
          {devices.length > 0 && (
            <BulkAssignButton
              homeName={homeName}
              devices={devices.map((d) => ({
                id: d.id,
                name: d.name,
                category: d.category ?? null,
                category_name: d.category_name ?? null,
              }))}
              properties={properties}
            />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("homeCard.noDevices")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead>{t("table.category")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
                <TableHead>{t("table.room")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => {
                const assignment = deviceMap.get(d.id) ?? null;
                const property = assignment
                  ? propertyById.get(assignment.property_id)
                  : null;
                const room =
                  assignment?.room_id != null
                    ? roomById.get(assignment.room_id)
                    : null;
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      {d.category_name ?? d.category ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.online ? "default" : "secondary"}>
                        {d.online ? t("status.online") : t("status.offline")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {assignment ? (
                        <div className="flex flex-col gap-0.5">
                          {/* Ambiente (room.name). Si el device aún no
                              tiene room asignado, mostramos el property.name
                              en gris para preservar context. */}
                          <span>
                            {room?.name ?? (
                              <span className="text-muted-foreground">
                                {property?.name ?? t("deletedProperty")}
                                <span className="ml-1 text-xs italic">
                                  {t("noRoomSuffix")}
                                </span>
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t(DEVICE_KIND_LABEL_KEY[assignment.device_kind]) ??
                              assignment.device_kind}
                            {assignment.is_primary && t("primarySuffix")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <AssignDeviceButton
                        tuyaDeviceId={d.id}
                        tuyaDeviceName={d.name}
                        properties={properties}
                        current={assignment}
                        suggestedKind={suggestDeviceKind(d)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
