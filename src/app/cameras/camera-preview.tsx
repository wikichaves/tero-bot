"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { requestCameraCapture } from "./actions";

export function CameraPreview({ cameraId, url, name, lastSnapshotAt, lastSyncedAt, captureRequestedAt }: { cameraId: string; url: string; name: string; lastSnapshotAt: string | null; lastSyncedAt: string | null; captureRequestedAt: string | null }) {
  const t = useTranslations("camerasPage.preview");
  const [version, setVersion] = useState(lastSnapshotAt ?? "initial");
  const [loading, setLoading] = useState(false);
  const [capturePending, setCapturePending] = useState(() => Boolean(captureRequestedAt && (!lastSyncedAt || new Date(captureRequestedAt) > new Date(lastSyncedAt))));
  const [captureError, setCaptureError] = useState(false);
  const src = url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(version);
  async function handleCaptureRequest() {
    setCapturePending(true);
    setCaptureError(false);
    try {
      const result = await requestCameraCapture({ cameraId });
      if (result.error) {
        setCapturePending(false);
        setCaptureError(true);
      }
    } catch {
      setCapturePending(false);
      setCaptureError(true);
    }
  }
  return <div className="grid gap-2">
    <div className="overflow-hidden rounded-lg border border-border bg-muted">
      <Image src={src} alt={t("alt", { name })} width={1280} height={720} unoptimized className="aspect-video w-full object-cover" onLoad={() => setLoading(false)} onError={() => setLoading(false)} />
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => { setLoading(true); setVersion(String(Date.now())); }} disabled={loading}>
        {loading ? t("updating") : t("update")}
      </Button>
      <Button type="button" size="sm" variant="outline" className="w-fit" onClick={handleCaptureRequest} disabled={capturePending}>
        {capturePending ? t("captureRequested") : t("requestCapture")}
      </Button>
    </div>
    {captureError && <p className="text-xs text-destructive" role="alert">{t("captureError")}</p>}
  </div>;
}
