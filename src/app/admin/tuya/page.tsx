import { format } from "date-fns";
import { es } from "date-fns/locale";
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
import type { Property } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TuyaPage() {
  const result = await listDevicesGroupedByHome().catch((err: Error) => ({
    error: err.message,
  }));

  if ("error" in result) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Tuya</h1>
          <p className="text-sm text-muted-foreground">
            Integración con Smart Life / Tuya Open API.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Error de conexión</CardTitle>
            <CardDescription>
              No se pudo hablar con el cloud de Tuya.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-destructive">
              {result.error}
            </pre>
            <ul className="mt-4 list-disc pl-5 text-muted-foreground">
              <li>
                Verificá que <code>TUYA_ACCESS_ID</code>,{" "}
                <code>TUYA_ACCESS_SECRET</code> y <code>TUYA_REGION</code>{" "}
                estén en <code>.env.local</code> (y en Vercel).
              </li>
              <li>
                Confirmá que el Cloud Project tenga las APIs requeridas
                autorizadas: <em>IoT Core</em>,{" "}
                <em>Authorization Token Management</em>,{" "}
                <em>Smart Home Basic Service</em>,{" "}
                <em>Smart Lock Open Service</em>.
              </li>
              <li>
                Asegurate de haber linkeado tu cuenta de Smart Life en{" "}
                <em>Devices → Link App Account</em>.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { user, homes } = result;

  // Properties + existing assignments in parallel.
  const supabase = await createClient();
  const [propertiesRes, deviceMap] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name")
      .order("name", { ascending: true }),
    listPropertyDeviceMap(),
  ]);
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name"
  >[];
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  const totalDevices = homes.reduce((acc, h) => acc + h.devices.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tuya</h1>
        <p className="text-sm text-muted-foreground">
          Integración con Smart Life / Tuya Open API.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cuenta linkeada</CardTitle>
          <CardDescription>
            Cuenta de la app Smart Life autorizada al Cloud Project.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {user ? (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Username</dt>
              <dd>{user.username ?? user.email ?? "—"}</dd>
              <dt className="text-muted-foreground">UID</dt>
              <dd className="font-mono text-xs">{user.uid}</dd>
              {user.create_time && (
                <>
                  <dt className="text-muted-foreground">Linkeado</dt>
                  <dd>
                    {format(new Date(user.create_time * 1000), "d MMM yyyy", {
                      locale: es,
                    })}
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Homes</dt>
              <dd>
                {homes.length} home{homes.length === 1 ? "" : "s"} con{" "}
                {totalDevices} device{totalDevices === 1 ? "" : "s"} en total
              </dd>
            </dl>
          ) : (
            <div className="text-muted-foreground space-y-2">
              <p>
                No se encontró ninguna cuenta linkeada vía los endpoints
                automáticos de Tuya.
              </p>
              <p>
                <strong>Workaround:</strong> agregá tu UID a las env vars como{" "}
                <code>TUYA_USER_UID</code>.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {homes.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No se encontraron homes. Si tu Smart Life tiene devices, asegurate
            que estén en una home (no en &ldquo;Sin Hogar&rdquo;). Después linkeá la
            cuenta de nuevo en el Cloud Project si hace falta.
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
        />
      ))}
    </div>
  );
}

function HomeCard({
  homeName,
  devices,
  properties,
  deviceMap,
  propertyById,
}: {
  homeName: string;
  devices: TuyaDevice[];
  properties: Pick<Property, "id" | "name">[];
  deviceMap: Awaited<ReturnType<typeof listPropertyDeviceMap>>;
  propertyById: Map<string, Pick<Property, "id" | "name">>;
}) {
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
            <CardTitle>Home: {homeName}</CardTitle>
            <CardDescription>
              {devices.length} device{devices.length === 1 ? "" : "s"}.{" "}
              {assignedNames.length > 0 && (
                <>
                  Asignados a:{" "}
                  <strong>{assignedNames.join(", ")}</strong>.
                </>
              )}{" "}
              {unassignedCount > 0 && (
                <span className="text-amber-700 dark:text-amber-300">
                  {unassignedCount} sin asignar.
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
          <p className="text-sm text-muted-foreground">Sin devices.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Propiedad</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => {
                const assignment = deviceMap.get(d.id) ?? null;
                const property = assignment
                  ? propertyById.get(assignment.property_id)
                  : null;
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      {d.category_name ?? d.category ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.online ? "default" : "secondary"}>
                        {d.online ? "online" : "offline"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {assignment ? (
                        <div className="flex flex-col gap-0.5">
                          <span>
                            {property?.name ?? "(propiedad eliminada)"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {assignment.device_kind}
                            {assignment.is_primary && " · primaria"}
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
