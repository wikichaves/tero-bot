import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getAllowedPropertyIds } from "@/lib/auth/scope";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Property, Room } from "@/lib/types";
import { NewAlarmRuleDialog } from "./new-alarm-rule-dialog";
import { AlarmRuleRow } from "./alarm-rule-row";
import { AlarmEventRow } from "./alarm-event-row";

/**
 * /admin/alarms — CRUD de reglas de alarma + lista de eventos activos
 * y recientes (WIK-82 Fase 3).
 *
 * Las reglas evaluan T y H en cada snapshot. Cuando se dispara, se
 * notifica por WhatsApp al admin/gestor con `whatsapp` configurado.
 *
 * Scopes:
 *   - global (sin FK) → aplica a TODOS los sensores
 *   - property → todos los sensores de una propiedad
 *   - room → todos los sensores de un ambiente
 *   - device → un sensor específico
 *
 * Una rule más específica NO sobreescribe una más general — ambas se
 * evalúan independiente. Si querés que solo aplique una, deshabilitar
 * la otra.
 */

export const dynamic = "force-dynamic";

type AlarmRuleRow = {
  id: string;
  property_id: string | null;
  room_id: string | null;
  property_device_id: string | null;
  metric: "temperature_c" | "humidity_pct";
  operator: "gt" | "lt";
  threshold: number;
  debounce_minutes: number;
  enabled: boolean;
  created_at: string;
};

type AlarmEventWithRel = {
  id: string;
  rule_id: string;
  property_device_id: string;
  fired_at: string;
  resolved_at: string | null;
  trigger_value: number;
  notified_via_whatsapp: boolean;
  rule: {
    metric: "temperature_c" | "humidity_pct";
    operator: "gt" | "lt";
    threshold: number;
  } | null;
  property_device: {
    tuya_device_name: string | null;
    property: { name: string } | null;
    room: { name: string } | null;
  } | null;
};

export default async function AlarmasPage() {
  const profile = await requireRole(["admin", "gestor"]);
  // WIK-94: gestor solo ve reglas y eventos de SUS properties.
  // Para alarm_rules, se filtra por property_id (las reglas con scope
  // global, room o device se mantienen visibles para admin pero gestor
  // solo ve las property-scoped que matcheen su scope).
  const allowedIds = await getAllowedPropertyIds(profile);
  const supabase = await createClient();

  let rulesQuery = supabase
    .from("alarm_rules")
    .select("*")
    .order("created_at", { ascending: false });
  if (allowedIds !== null) {
    // Gestor: solo reglas con property_id en su scope. Las reglas
    // globales (property_id null) son del admin.
    rulesQuery = rulesQuery.in("property_id", allowedIds);
  }

  let eventsQuery = supabase
    .from("alarm_events")
    .select(
      "id, rule_id, property_device_id, fired_at, resolved_at, trigger_value, notified_via_whatsapp, rule:alarm_rules(metric, operator, threshold), property_device:property_devices!inner(property_id, tuya_device_name, property:properties(name), room:rooms(name))",
    )
    .order("fired_at", { ascending: false })
    .limit(50);
  if (allowedIds !== null) {
    // Foreign filter: events cuyo device pertenece a una property scoped.
    eventsQuery = eventsQuery.in("property_device.property_id", allowedIds);
  }

  let propsQuery = supabase
    .from("properties")
    .select("id, name")
    .order("sort_order", { ascending: true });
  if (allowedIds !== null) propsQuery = propsQuery.in("id", allowedIds);

  let roomsQuery = supabase.from("rooms").select("id, name, property_id");
  if (allowedIds !== null) roomsQuery = roomsQuery.in("property_id", allowedIds);

  let devicesQuery = supabase
    .from("property_devices")
    .select("id, tuya_device_name, property_id")
    .eq("device_kind", "sensor");
  if (allowedIds !== null) devicesQuery = devicesQuery.in("property_id", allowedIds);

  const [rulesRes, eventsRes, propsRes, roomsRes, devicesRes] =
    await Promise.all([rulesQuery, eventsQuery, propsQuery, roomsQuery, devicesQuery]);

  const rules = (rulesRes.data ?? []) as AlarmRuleRow[];
  const events = (eventsRes.data ?? []) as unknown as AlarmEventWithRel[];
  const properties = (propsRes.data ?? []) as Pick<
    Property,
    "id" | "name"
  >[];
  const rooms = (roomsRes.data ?? []) as Pick<
    Room,
    "id" | "name" | "property_id"
  >[];
  const sensors = (devicesRes.data ?? []) as Array<{
    id: string;
    tuya_device_name: string | null;
    property_id: string;
  }>;

  const propertyById = new Map(properties.map((p) => [p.id, p]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const activeEvents = events.filter((e) => e.resolved_at == null);
  const recentResolved = events.filter((e) => e.resolved_at != null).slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl">Alarmas</h1>
          <p className="text-sm text-muted-foreground">
            Reglas configurables para temperatura y humedad. Notifican
            por WhatsApp al admin/gestor cuando se disparan.
          </p>
        </div>
        <NewAlarmRuleDialog
          properties={properties}
          rooms={rooms}
          sensors={sensors}
        />
      </div>

      {activeEvents.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {activeEvents.length} alarma{activeEvents.length === 1 ? "" : "s"} activa
              {activeEvents.length === 1 ? "" : "s"}
            </CardTitle>
            <CardDescription>
              Eventos sin resolver. La métrica todavía está fuera de rango,
              o la alarma quedó abierta y nadie la resolvió manualmente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeEvents.map((e) => (
              <AlarmEventRow
                key={e.id}
                event={e}
                propertyById={propertyById}
                roomById={roomById}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reglas</CardTitle>
          <CardDescription>
            {rules.length} regla{rules.length === 1 ? "" : "s"} configurada
            {rules.length === 1 ? "" : "s"}.{" "}
            {rules.filter((r) => !r.enabled).length > 0 &&
              `${rules.filter((r) => !r.enabled).length} deshabilitada${
                rules.filter((r) => !r.enabled).length === 1 ? "" : "s"
              }.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No hay reglas configuradas. Apretá &ldquo;Nueva regla&rdquo; para empezar.
            </p>
          ) : (
            <div className="space-y-2">
              {rules.map((r) => (
                <AlarmRuleRow
                  key={r.id}
                  rule={r}
                  properties={properties}
                  rooms={rooms}
                  sensors={sensors}
                  propertyById={propertyById}
                  roomById={roomById}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {recentResolved.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Resueltas recientemente
            </CardTitle>
            <CardDescription>
              Últimas {recentResolved.length} alarmas que volvieron a rango.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentResolved.map((e) => (
              <AlarmEventRow
                key={e.id}
                event={e}
                propertyById={propertyById}
                roomById={roomById}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
