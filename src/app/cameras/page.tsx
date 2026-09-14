import { Camera, ExternalLink, Plus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { getActiveCountry, getCountryPropertyIds } from "@/lib/country";
import { createClient } from "@/lib/supabase/server";
import type { PropertyCamera } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteCamera, saveCamera } from "./actions";
import { CameraEditForm } from "./camera-edit-form";
import { CameraPreview } from "./camera-preview";

type CameraWithProperty = PropertyCamera & { property: { name: string } | null };

export default async function CamerasPage() {
  const [profile, locale, t] = await Promise.all([
    requireRole(["admin", "gestor"]),
    getLocale(),
    getTranslations("camerasPage"),
  ]);
  const allowedIds = await getAllowedPropertyIds(profile);
  const country = await getActiveCountry(allowedIds);
  const propertyIds = await getCountryPropertyIds(country, allowedIds);
  const db = await createClient();
  const [{ data: cameras }, { data: properties }] = await Promise.all([
    db.from("property_cameras").select("*, property:properties(name)").in("property_id", propertyIds).order("sort_order").order("name"),
    db.from("properties").select("id, name").in("id", propertyIds).order("name"),
  ]);
  return <div className="grid gap-8">
    <div><h1 className="text-4xl">{t("title")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("description")}</p></div>
    <details className="rounded-xl border border-border bg-card p-5"><summary className="flex cursor-pointer list-none items-center gap-2 font-medium"><Plus className="size-4" /> {t("addCamera")}</summary><form action={saveCamera} className="mt-5 grid gap-4"><CameraFields properties={properties ?? []} labels={getFieldLabels(t)} /><Button className="w-fit" type="submit">{t("saveCamera")}</Button></form></details>
    {(cameras ?? []).length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</CardContent></Card> : <div className="grid gap-4 md:grid-cols-2">{(cameras ?? []).map((camera) => <CameraCard key={camera.id} camera={camera as CameraWithProperty} properties={properties ?? []} locale={locale} labels={getFieldLabels(t)} text={{ open: t("open"), photo: t("photo"), streamConfigured: t("streamConfigured"), appAccess: t("appAccess"), stale: t("stale"), syncStatus: t.raw("syncStatus"), edit: t("edit"), delete: t("delete"), justNow: t("relative.justNow"), minutesAgo: t.raw("relative.minutesAgo"), hoursAgo: t.raw("relative.hoursAgo"), daysAgo: t.raw("relative.daysAgo") }} />)}</div>}
  </div>;
}

type FieldLabels = ReturnType<typeof getFieldLabels>;
type CardText = { open: string; photo: string; streamConfigured: string; appAccess: string; stale: string; syncStatus: string; edit: string; delete: string; justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string };

function CameraCard({ camera, properties, locale, labels, text }: { camera: CameraWithProperty; properties: { id: string; name: string }[]; locale: string; labels: FieldLabels; text: CardText }) {
  const ageMinutes = camera.last_snapshot_at ? getAgeMinutes(camera.last_snapshot_at) : null;
  const syncAgeMinutes = camera.last_synced_at ? getAgeMinutes(camera.last_synced_at) : null;
  const showSyncStatus = camera.last_snapshot_at !== null && camera.last_synced_at !== null
    && Math.abs(new Date(camera.last_synced_at).getTime() - new Date(camera.last_snapshot_at).getTime()) > 10 * 60 * 1000;
  const freshnessClass = ageMinutes === null || ageMinutes < 15 ? "text-muted-foreground" : ageMinutes <= 60 ? "text-status-warning" : "text-status-critical";
  const capturedAt = camera.last_snapshot_at ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(camera.last_snapshot_at)) : null;
  return <Card><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Camera className="size-5" />{camera.name}</CardTitle><CardDescription>{camera.property?.name}{camera.location ? ` · ${camera.location}` : ""}</CardDescription></div>{camera.access_url && <Button size="sm" variant="outline" render={<a href={camera.access_url} target="_blank" rel="noreferrer" />}><ExternalLink className="size-4" /> {text.open}</Button>}</div></CardHeader><CardContent className="grid gap-3 text-sm">{camera.snapshot_url && <CameraPreview url={camera.snapshot_url} name={camera.name} lastSnapshotAt={camera.last_snapshot_at} />}<div><p className={freshnessClass}>{camera.provider}{camera.last_snapshot_at ? ` · ${text.photo} ${relTime(ageMinutes ?? 0, text)} · ${capturedAt}` : camera.stream_url ? ` · ${text.streamConfigured}` : ` · ${text.appAccess}`}{ageMinutes !== null && ageMinutes > 60 ? ` · ${text.stale}` : ""}</p>{showSyncStatus && syncAgeMinutes !== null && <p className="mt-1 text-xs text-muted-foreground">{text.syncStatus.replace("{capture}", relTime(ageMinutes ?? 0, text)).replace("{sync}", relTime(syncAgeMinutes, text))}</p>}</div>{camera.notes && <p>{camera.notes}</p>}<details><summary className="cursor-pointer text-muted-foreground hover:text-foreground">{text.edit}</summary><CameraEditForm><input type="hidden" name="id" value={camera.id} /><CameraFields camera={camera} properties={properties} labels={labels} /></CameraEditForm></details><form action={deleteCamera}><input type="hidden" name="id" value={camera.id} /><input type="hidden" name="property_id" value={camera.property_id} /><Button type="submit" size="sm" variant="ghost" className="w-fit text-destructive hover:text-destructive">{text.delete}</Button></form></CardContent></Card>;
}

function CameraFields({ properties, camera, labels }: { properties: { id: string; name: string }[]; camera?: PropertyCamera; labels: FieldLabels }) {
  return <><div className="grid gap-2"><Label>{labels.property}</Label><select name="property_id" defaultValue={camera?.property_id} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" required><option value="">{labels.chooseProperty}</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></div><div className="grid gap-4 sm:grid-cols-2"><Field label={labels.name} name="name" defaultValue={camera?.name} required /><Field label={labels.location} name="location" defaultValue={camera?.location ?? ""} placeholder={labels.locationPlaceholder} /></div><div className="grid gap-4 sm:grid-cols-2"><Field label={labels.provider} name="provider" defaultValue={camera?.provider ?? "Cloud Plus"} /><Field label={labels.accessLink} name="access_url" type="url" defaultValue={camera?.access_url ?? ""} placeholder="https://…" /></div><details className="text-muted-foreground"><summary className="cursor-pointer">{labels.technicalOptions}</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label={labels.streamUrl} name="stream_url" defaultValue={camera?.stream_url ?? ""} placeholder="rtsp://…" /><Field label={labels.snapshotUrl} name="snapshot_url" type="url" defaultValue={camera?.snapshot_url ?? ""} placeholder="https://…" /></div></details><div className="grid gap-2"><Label>{labels.notes}</Label><textarea name="notes" defaultValue={camera?.notes ?? ""} className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm" placeholder={labels.notesPlaceholder} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={camera?.is_active ?? true} /> {labels.active}</label></>;
}

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <div className="grid gap-2"><Label>{label}</Label><Input {...props} /></div>; }

function getFieldLabels(t: Awaited<ReturnType<typeof getTranslations>>) {
  return { property: t("fields.property"), chooseProperty: t("fields.chooseProperty"), name: t("fields.name"), location: t("fields.location"), locationPlaceholder: t("fields.locationPlaceholder"), provider: t("fields.provider"), accessLink: t("fields.accessLink"), technicalOptions: t("fields.technicalOptions"), streamUrl: t("fields.streamUrl"), snapshotUrl: t("fields.snapshotUrl"), notes: t("fields.notes"), notesPlaceholder: t("fields.notesPlaceholder"), active: t("fields.active") };
}

function getAgeMinutes(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function relTime(mins: number, text: CardText) {
  if (mins < 1) return text.justNow;
  if (mins < 60) return text.minutesAgo.replace("{minutes}", String(mins));
  const hours = Math.round(mins / 60);
  if (hours < 24) return text.hoursAgo.replace("{hours}", String(hours));
  return text.daysAgo.replace("{days}", String(Math.round(hours / 24)));
}
