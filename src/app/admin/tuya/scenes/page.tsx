import Link from "next/link";
import { ArrowLeft, Play } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth";
import { listDevicesGroupedByHome } from "@/lib/tuya/devices";
import { listScenesForHome, type TapToRunScene } from "@/lib/tuya/scenes";
import { RunSceneButton } from "./run-scene-button";

/**
 * /admin/tuya/scenes — listar y ejecutar Tap-to-Run scenes de Tuya
 * (WIK-103). Solo admin: los scenes pueden disparar acciones físicas
 * (luces, cerraduras, estufas).
 *
 * Se agrupan por home — un cloud project Tuya puede tener varios
 * homes y cada uno con sus propios scenes.
 */

export const dynamic = "force-dynamic";

type SceneWithHomeName = TapToRunScene & { home_name: string };

export default async function ScenesPage() {
  await requireRole(["admin"]);

  const t = await getTranslations("adminTuyaScenes");

  const grouped = await listDevicesGroupedByHome().catch((err: Error) => ({
    error: err.message,
  }));

  if ("error" in grouped) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            {t("tuyaError", { error: grouped.error })}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pull scenes de cada home en paralelo. Si alguno falla, lo
  // marcamos con error pero no abortamos toda la página.
  const scenesByHome = await Promise.all(
    grouped.homes.map(async ({ home }) => {
      try {
        const scenes = await listScenesForHome(home.home_id);
        return {
          home_id: String(home.home_id),
          home_name: home.name,
          scenes: scenes.map(
            (s): SceneWithHomeName => ({ ...s, home_name: home.name }),
          ),
          error: null as string | null,
        };
      } catch (e) {
        return {
          home_id: String(home.home_id),
          home_name: home.name,
          scenes: [] as SceneWithHomeName[],
          error: (e as Error).message,
        };
      }
    }),
  );

  const totalScenes = scenesByHome.reduce(
    (sum, h) => sum + h.scenes.length,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <Header />
      <div>
        <p className="text-sm text-muted-foreground">
          {t("summary", {
            count: totalScenes,
            homes: grouped.homes.length,
          })}
        </p>
      </div>

      {scenesByHome.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t("noHomes.before")}{" "}
            <Link href="/admin/tuya" className="underline">
              /admin/tuya
            </Link>
            {t("noHomes.after")}
          </CardContent>
        </Card>
      )}

      {scenesByHome.map((home) => (
        <section key={home.home_id} className="flex flex-col gap-3">
          <h2 className="text-lg">{home.home_name}</h2>
          {home.error ? (
            <Card className="border-destructive/30">
              <CardContent className="pt-6 text-sm text-destructive">
                {t("listError", { error: home.error })}
              </CardContent>
            </Card>
          ) : home.scenes.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                {t("emptyHome")}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {home.scenes.map((scene) => (
                <Card key={scene.id} className="h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      <span className="min-w-0 flex-1 truncate">
                        {scene.name}
                      </span>
                      {!scene.status && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-normal"
                        >
                          {t("disabled")}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs font-mono break-all">
                      {scene.id}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <RunSceneButton
                      sceneId={scene.id}
                      sceneName={scene.name}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("about.title")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>{t("about.p1")}</p>
          <p>{t("about.p2")}</p>
          <p className="flex items-center gap-1.5">
            <Play className="h-3.5 w-3.5" /> {t("about.p3")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

async function Header() {
  const t = await getTranslations("adminTuyaScenes");
  return (
    <div>
      <Link
        href="/admin/tuya"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("back")}
      </Link>
      <h1 className="mt-2 text-4xl">Tap-to-Run</h1>
    </div>
  );
}
