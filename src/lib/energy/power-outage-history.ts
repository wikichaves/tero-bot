import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * WIK-342: historial de cortes de luz + stats de voltaje por propiedad, para
 * la vista "snapshot visual de cortes" en /energy.
 *
 * Cortes: alarm_events de reglas metric='power_outage', linkeados a property
 * vía alarm_rules.property_id. Un evento = un corte (fired_at → resolved_at).
 * Los de resolved_at === fired_at (o muy cerca) son micro-cortes/bajones de
 * segundos; los largos son cortes reales.
 *
 * Voltaje: min/p5/mediana/actual del breaker principal de la property en la
 * ventana, desde energy_snapshots.voltage_v. Sirve para ver si la tensión está
 * sana o crónicamente baja (antesala de cortes).
 */

export type OutageEvent = {
  firedAt: string;
  resolvedAt: string | null;
  /** Duración en minutos; null si sigue abierto. */
  durationMin: number | null;
  /** true si duró < 1 min (micro-corte / bajón de tensión). */
  micro: boolean;
};

export type VoltageStats = {
  current: number | null;
  min: number | null;
  p5: number | null;
  median: number | null;
  samples: number;
};

export type PropertyOutageSummary = {
  propertyId: string;
  outages: OutageEvent[];
  totalOutages: number;
  microOutages: number;
  realOutages: number;
  voltage: VoltageStats;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx];
}

/**
 * Trae el resumen de cortes + voltaje para las properties dadas, en la ventana
 * [sinceIso, now]. Batcheado: 2 queries (alarm_events + energy_snapshots).
 */
export async function getPowerOutageSummaries(
  admin: SupabaseClient,
  propertyIds: string[],
  primaryMeterByProperty: Map<string, string>,
  sinceIso: string,
): Promise<Map<string, PropertyOutageSummary>> {
  const out = new Map<string, PropertyOutageSummary>();
  if (propertyIds.length === 0) return out;

  // 1. Cortes de luz de estas properties en la ventana.
  const { data: evs } = await admin
    .from("alarm_events")
    .select(
      "fired_at, resolved_at, rule:alarm_rules!inner(metric, property_id)",
    )
    .eq("rule.metric", "power_outage")
    .in("rule.property_id", propertyIds)
    .gte("fired_at", sinceIso)
    .order("fired_at", { ascending: false })
    .returns<
      Array<{
        fired_at: string;
        resolved_at: string | null;
        rule: { metric: string; property_id: string } | null;
      }>
    >();

  const outagesByProperty = new Map<string, OutageEvent[]>();
  for (const e of evs ?? []) {
    const pid = e.rule?.property_id;
    if (!pid) continue;
    let durationMin: number | null = null;
    if (e.resolved_at) {
      durationMin =
        (new Date(e.resolved_at).getTime() - new Date(e.fired_at).getTime()) /
        60000;
    }
    const ev: OutageEvent = {
      firedAt: e.fired_at,
      resolvedAt: e.resolved_at,
      durationMin,
      micro: durationMin != null && durationMin < 1,
    };
    const arr = outagesByProperty.get(pid) ?? [];
    arr.push(ev);
    outagesByProperty.set(pid, arr);
  }

  // 2. Voltaje: snapshots del breaker principal de cada property en la ventana.
  const meterIds = Array.from(primaryMeterByProperty.values());
  const voltsByMeter = new Map<string, number[]>();
  const latestByMeter = new Map<string, { ms: number; v: number }>();
  if (meterIds.length > 0) {
    const { data: snaps } = await admin
      .from("energy_snapshots")
      .select("property_device_id, voltage_v, taken_at")
      .in("property_device_id", meterIds)
      .gte("taken_at", sinceIso)
      .not("voltage_v", "is", null)
      .order("taken_at", { ascending: true })
      .limit(200_000);
    for (const s of (snaps ?? []) as Array<{
      property_device_id: string;
      voltage_v: number | null;
      taken_at: string;
    }>) {
      if (s.voltage_v == null) continue;
      const v = Number(s.voltage_v);
      const arr = voltsByMeter.get(s.property_device_id) ?? [];
      arr.push(v);
      voltsByMeter.set(s.property_device_id, arr);
      const ms = new Date(s.taken_at).getTime();
      const cur = latestByMeter.get(s.property_device_id);
      if (!cur || ms > cur.ms) latestByMeter.set(s.property_device_id, { ms, v });
    }
  }

  for (const pid of propertyIds) {
    const outages = outagesByProperty.get(pid) ?? [];
    const meterId = primaryMeterByProperty.get(pid);
    const volts = meterId ? (voltsByMeter.get(meterId) ?? []) : [];
    const sorted = [...volts].sort((a, b) => a - b);
    const voltage: VoltageStats = {
      current: meterId ? (latestByMeter.get(meterId)?.v ?? null) : null,
      min: sorted.length > 0 ? sorted[0] : null,
      p5: percentile(sorted, 5),
      median: percentile(sorted, 50),
      samples: sorted.length,
    };
    out.set(pid, {
      propertyId: pid,
      outages,
      totalOutages: outages.length,
      microOutages: outages.filter((o) => o.micro).length,
      realOutages: outages.filter((o) => !o.micro).length,
      voltage,
    });
  }
  return out;
}
