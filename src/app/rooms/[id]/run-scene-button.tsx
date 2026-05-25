"use client";

import { useTransition } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { runScene } from "@/app/admin/tuya/scenes/actions";

/**
 * Botón "Run" para un tap-to-run scene desde la página de detalle
 * de un room (WIK-172). Reusa la server action de
 * `@/app/admin/tuya/scenes/actions` — sigue siendo admin-only por
 * el `requireRole(["admin"])` dentro.
 *
 * Equivalente al RunSceneButton de admin/tuya/scenes pero con
 * strings traducidos por next-intl (la versión admin tiene hardcoded
 * Spanish; esta vive en una página de scope más amplio).
 */
export function RunSceneButton({
  sceneId,
  sceneName,
}: {
  sceneId: string;
  sceneName: string;
}) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("roomDetail.scenes");

  function run() {
    startTransition(async () => {
      const r = await runScene(sceneId);
      if (r?.error) {
        toast.error(t("error", { name: sceneName, error: r.error }));
      } else {
        toast.success(t("ran", { name: sceneName }));
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={run}
      disabled={pending}
      className="justify-start"
    >
      <Play className="mr-2 h-3.5 w-3.5" />
      {pending ? t("running") : sceneName}
    </Button>
  );
}
