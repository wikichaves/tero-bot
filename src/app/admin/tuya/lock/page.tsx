import Link from "next/link";
import { requireRole } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listAllDevices, type TuyaDevice } from "@/lib/tuya/devices";
import { listOfflineTempPasswords, type LockTempPassword } from "@/lib/tuya/lock";
import { listPropertyDeviceMap } from "@/lib/tuya/property-devices";
import { createClient } from "@/lib/supabase/server";
import type { Property } from "@/lib/types";
import { LockCard } from "./lock-card";

export const dynamic = "force-dynamic";

function isLock(d: TuyaDevice): boolean {
  const cat = (d.category ?? "").toLowerCase();
  const catName = (d.category_name ?? "").toLowerCase();
  return /lock|ms\b/.test(cat) || /lock/.test(catName);
}

export default async function LockPage() {
  await requireRole(["admin", "gestor"]);

  const result = await listAllDevices().catch((err: Error) => ({
    error: err.message,
  }));

  if ("error" in result) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
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
          </CardContent>
        </Card>
      </div>
    );
  }

  const locks = result.devices.filter(isLock);

  if (locks.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No se encontraron cerraduras (categoría <em>Residential Lock</em>)
            entre los {result.devices.length} devices del Cloud Project. Verificá
            en <Link href="/admin/tuya" className="underline">/admin/tuya</Link>{" "}
            que la cerradura esté linkeada y aparezca con su categoría correcta.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pull property assignments + load passwords per lock in parallel.
  const supabase = await createClient();
  const [propertiesRes, deviceMap] = await Promise.all([
    supabase.from("properties").select("id, name"),
    listPropertyDeviceMap(),
  ]);
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name"
  >[];
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  const lockSnapshots = await Promise.all(
    locks.map(async (lock) => {
      let initialPasswords: LockTempPassword[] = [];
      let listError: string | null = null;
      try {
        initialPasswords = await listOfflineTempPasswords(lock.id);
      } catch (e) {
        listError = (e as Error).message;
      }
      const assignment = deviceMap.get(lock.id) ?? null;
      const property = assignment
        ? (propertyById.get(assignment.property_id) ?? null)
        : null;
      return {
        lock,
        assignment,
        property,
        initialPasswords,
        listError,
      };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <Header />
      {lockSnapshots.map(({ lock, assignment, property, initialPasswords, listError }) => (
        <LockCard
          key={lock.id}
          deviceId={lock.id}
          deviceName={lock.name}
          online={lock.online}
          propertyName={property?.name ?? null}
          isPrimary={!!assignment?.is_primary}
          initialPasswords={initialPasswords}
          listError={listError}
        />
      ))}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Cerraduras</h1>
      <p className="text-sm text-muted-foreground">
        Generá códigos temporales de prueba en cada cerradura. Una vez que
        confirmes que un código abre la puerta físicamente, podemos engancharlo
        con el flow automático de reservas (WIK-29).
      </p>
    </div>
  );
}
