"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function CameraPreview({ url, name, lastSnapshotAt }: { url: string; name: string; lastSnapshotAt: string | null }) {
  const t = useTranslations("camerasPage.preview");
  const [version, setVersion] = useState(lastSnapshotAt ?? "initial");
  const [loading, setLoading] = useState(false);
  const src = url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(version);
  return <div className="grid gap-2">
    <div className="overflow-hidden rounded-lg border border-border bg-muted">
      <Image src={src} alt={t("alt", { name })} width={1280} height={720} unoptimized className="aspect-video w-full object-cover" onLoad={() => setLoading(false)} onError={() => setLoading(false)} />
    </div>
    <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => { setLoading(true); setVersion(String(Date.now())); }} disabled={loading}>
      {loading ? t("updating") : t("update")}
    </Button>
  </div>;
}
