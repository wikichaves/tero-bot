"use client";

import { useTransition } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runScene } from "./actions";

/**
 * Botón "Ejecutar" para un tap-to-run scene (WIK-103). Wrapper client
 * que llama a la server action y muestra toast de resultado.
 */
export function RunSceneButton({
  sceneId,
  sceneName,
}: {
  sceneId: string;
  sceneName: string;
}) {
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const r = await runScene(sceneId);
      if (r?.error) {
        toast.error(`No se pudo ejecutar: ${r.error}`);
      } else {
        toast.success(`Ejecutado: ${sceneName}`);
      }
    });
  }

  return (
    <Button
      type="button"
      variant="default"
      size="sm"
      onClick={run}
      disabled={pending}
    >
      <Play className="mr-2 h-3.5 w-3.5" />
      {pending ? "Ejecutando…" : "Ejecutar"}
    </Button>
  );
}
