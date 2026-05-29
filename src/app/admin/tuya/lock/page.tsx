import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listAllDevices, type TuyaDevice } from "@/lib/tuya/devices";
import { listPropertyDeviceMap } from "@/lib/tuya/property-devices";
import { createClient } from "@/lib/supabase/server";
import type { LockPassword, Property } from "@/lib/types";
import { LockCard } from "./lock-card";

export const dynamic = "force-dynamic";

function isLock(d: TuyaDevice): boolean {
  const cat = (d.category ?? "").toLowerCase();
  const catName = (d.category_name ?? "").toLowerCase();
  return /lock|ms\b/.test(cat) || /lock/.test(catName);
}

export default async function LockPage() {
  await requireRole(["admin", "gestor"]);
  const t = await getTranslations("adminTuyaLockPage");

  const result = await listAllDevices().catch((err: Error) => ({
    error: err.message,
  }));

  if ("error" in result) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>{t("error.title")}</CardTitle>
            <CardDescription>{t("error.description")}</CardDescription>
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
            {t.rich("empty", {
              count: result.devices.length,
              em: (chunks) => <em>{chunks}</em>,
              link: (chunks) => (
                <Link href="/admin/tuya" className="underline">
                  {chunks}
                </Link>
              ),
            })}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pull property assignments + active passwords for the locks.
  const supabase = await createClient();
  const [propertiesRes, deviceMap, passwordsRes] = await Promise.all([
    supabase.from("properties").select("id, name"),
    listPropertyDeviceMap(),
    supabase
      .from("lock_passwords")
      .select("*")
      .eq("status", "active")
      .order("effective_time", { ascending: false }),
  ]);
  const properties = (propertiesRes.data ?? []) as Pick<
    Property,
    "id" | "name"
  >[];
  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const allPasswords = (passwordsRes.data ?? []) as LockPassword[];

  return (
    <div className="flex flex-col gap-6">
      <Header />
      {locks.map((lock) => {
        const assignment = deviceMap.get(lock.id) ?? null;
        const property = assignment
          ? (propertyById.get(assignment.property_id) ?? null)
          : null;
        const passwords = assignment
          ? allPasswords.filter((p) => p.property_device_id === assignment.id)
          : [];
        return (
          <LockCard
            key={lock.id}
            deviceId={lock.id}
            deviceName={lock.name}
            online={lock.online}
            propertyName={property?.name ?? null}
            isPrimary={!!assignment?.is_primary}
            initialPasswords={passwords}
          />
        );
      })}
    </div>
  );
}

async function Header() {
  const t = await getTranslations("adminTuyaLockPage");
  return (
    <div>
      <h1 className="text-4xl">{t("header.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("header.description")}</p>
    </div>
  );
}
