import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_HOST } from "@/lib/brand";
import {
  persistMessage,
  sendKapsoTemplateWithFallback,
  sendKapsoText,
  upsertConversation,
} from "@/lib/whatsapp/index";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import type { EvaluatedEvent } from "./alarms";

/**
 * Notifica por WhatsApp a admin + gestor cuando una alarma se dispara
 * o se resuelve (WIK-82 F3).
 *
 * Reglas:
 *   - WIK-275: si la regla tiene destinatarios asignados (tabla
 *     `alarm_rule_recipients`), notificamos solo a esos profiles que
 *     tengan `whatsapp`. Si no tiene ninguno (reglas legacy), caemos al
 *     comportamiento histórico: todos los admin/gestor con `whatsapp`.
 *   - Enviamos por TEMPLATE UTILITY (sensor_alarm_fired_v2 /
 *     sensor_alarm_resolved / power_outage_fired / power_outage_resolved).
 *     Es la única forma de que la alarma llegue FUERA de la ventana 24h —
 *     que es el caso típico, porque la ventana solo la abre un mensaje
 *     entrante del destinatario, no los que manda el bot. Si el template
 *     falla (p.ej. todavía no está APPROVED en Meta) caemos a texto libre,
 *     que entra solo si la ventana está abierta.
 *   - Si el send falla, el mensaje queda persisted en la inbox con
 *     status=failed para que admin vea el intento. Marca
 *     `notified_via_whatsapp=false`.
 *   - Si el send funciona en al menos un destinatario, marca
 *     `notified_via_whatsapp=true` (uno notificado es suficiente — no
 *     queremos volver a intentar si después conectamos a otro admin).
 *
 * Out of scope: rate limiting per recipient.
 */

function coerceLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

function unitOf(metric: "temperature_c" | "humidity_pct"): string {
  return metric === "temperature_c" ? "°C" : "%";
}

function labelOf(metric: "temperature_c" | "humidity_pct"): string {
  return metric === "temperature_c" ? "Temperatura" : "Humedad";
}

/** Palabra de la métrica para la variable {{1}} del template (localizada). */
function metricWord(
  metric: "temperature_c" | "humidity_pct",
  locale: Locale,
): string {
  if (locale === "en") {
    return metric === "temperature_c" ? "temperature" : "humidity";
  }
  return metric === "temperature_c" ? "temperatura" : "humedad";
}

/** Ambiente para la variable de ubicación: "Living · Casa A" o "Casa A". */
function ambienteOf(ev: EvaluatedEvent): string {
  const property = ev.device.property_name ?? "—";
  return ev.device.room_name ? `${ev.device.room_name} · ${property}` : property;
}

/**
 * Mapea un evento de alarma al template UTILITY + sus variables (en el
 * orden de los `{{N}}` del body). Los templates son la única forma de
 * notificar fuera de la ventana 24h de WhatsApp.
 */
function alarmTemplate(
  ev: EvaluatedEvent,
  locale: Locale,
): { name: string; vars: string[] } {
  if (ev.rule.metric === "power_outage") {
    const property = ev.device.property_name ?? ambienteOf(ev);
    return {
      name:
        ev.kind === "fired" ? "power_outage_fired" : "power_outage_resolved",
      vars: [property],
    };
  }
  const m = ev.rule.metric;
  const value = ev.value ?? 0;
  const threshold = ev.rule.threshold ?? 0;
  const unit = unitOf(m);
  const valStr =
    m === "temperature_c"
      ? `${value.toFixed(1)}${unit}`
      : `${value.toFixed(0)}${unit}`;
  const thrStr =
    m === "temperature_c"
      ? `${threshold.toFixed(1)}${unit}`
      : `${threshold.toFixed(0)}${unit}`;
  const op = ev.rule.operator === "gt" ? ">" : "<";
  return {
    name:
      ev.kind === "fired" ? "sensor_alarm_fired_v2" : "sensor_alarm_resolved",
    vars: [metricWord(m, locale), valStr, ambienteOf(ev), `${op} ${thrStr}`],
  };
}

function buildMessage(ev: EvaluatedEvent): string {
  const location = ev.device.room_name
    ? `${ev.device.room_name} (${ev.device.property_name ?? "—"})`
    : (ev.device.property_name ?? "—");

  // WIK-281: corte de luz — detectado por el DP `fault` del breaker, sin
  // valor numérico.
  if (ev.rule.metric === "power_outage") {
    const property = ev.device.property_name ?? location;
    const breakerLine = ev.device.device_name
      ? `\n_Llave: ${ev.device.device_name}_`
      : "";
    if (ev.kind === "fired") {
      return (
        `*Corte de luz en ${property}*\n\n` +
        `La llave reportó falta de tensión — probablemente no hay energía en la propiedad.` +
        breakerLine +
        `\n\n_Detalle: ${APP_HOST}/rooms_`
      );
    }
    return (
      `*Volvió la luz en ${property}*\n\n` +
      `La llave de luz volvió a conectarse.` +
      breakerLine
    );
  }

  // Temp/humedad (threshold). Acá `value`/`threshold` siempre vienen (la
  // regla los define); `?? 0` es defensa para TS por los tipos nullable.
  const m = ev.rule.metric;
  const op = ev.rule.operator === "gt" ? ">" : "<";
  const value = ev.value ?? 0;
  const threshold = ev.rule.threshold ?? 0;
  const valStr = m === "temperature_c"
    ? `${value.toFixed(1)}${unitOf(m)}`
    : `${value.toFixed(0)}${unitOf(m)}`;
  const thrStr = m === "temperature_c"
    ? `${threshold.toFixed(1)}${unitOf(m)}`
    : `${threshold.toFixed(0)}${unitOf(m)}`;
  const sensorLine = ev.device.device_name
    ? `\n_Sensor: ${ev.device.device_name}_`
    : "";

  if (ev.kind === "fired") {
    return (
      `*Alarma de ${labelOf(m).toLowerCase()}*\n\n` +
      `*${valStr}* en *${location}*\n` +
      `Umbral: ${op} ${thrStr}` +
      sensorLine +
      `\n\n_Detalle: ${APP_HOST}/rooms_`
    );
  }
  // resolved
  return (
    `*Alarma resuelta*\n\n` +
    `${labelOf(m)} volvió a *${valStr}* en *${location}* ` +
    `(umbral ${op} ${thrStr})` +
    sensorLine
  );
}

/**
 * Notifica un evento de alarma por WhatsApp. Best-effort, nunca tira:
 * si todo falla, los logs quedan en console.error y el caller continúa.
 *
 * Devuelve `true` si al menos un destinatario recibió el mensaje OK.
 */
export async function notifyAlarmEvent(ev: EvaluatedEvent): Promise<boolean> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiKey = process.env.KAPSO_API_KEY;
  if (!phoneNumberId || !apiKey) {
    console.log("[notifyAlarmEvent] WhatsApp env not configured, skipping");
    return false;
  }

  const admin = createAdminClient();

  type Recipient = {
    id: string;
    full_name: string | null;
    whatsapp: string | null;
    role: string;
    language: string | null;
  };

  // WIK-275: destinatarios asignados explícitamente a la regla.
  const { data: assignedRows, error: assignedErr } = await admin
    .from("alarm_rule_recipients")
    .select("profile:profiles(id, full_name, whatsapp, role, language)")
    .eq("rule_id", ev.rule.id);
  if (assignedErr) {
    console.warn(
      "[notifyAlarmEvent] assigned recipients lookup failed:",
      assignedErr.message,
    );
  }
  let recipients: Recipient[] = (assignedRows ?? []).flatMap((r) => {
    const p = (r as { profile: Recipient | Recipient[] | null }).profile;
    if (!p) return [];
    return Array.isArray(p) ? p : [p];
  });

  // Fallback (reglas legacy o sin nadie asignado): todos los admin/gestor
  // con whatsapp configurado — el comportamiento histórico.
  if (recipients.length === 0) {
    const { data: fallback, error } = await admin
      .from("profiles")
      .select("id, full_name, whatsapp, role, language")
      .in("role", ["admin", "gestor"])
      .not("whatsapp", "is", null);
    if (error) {
      console.warn(
        "[notifyAlarmEvent] recipients lookup failed:",
        error.message,
      );
      return false;
    }
    recipients = (fallback ?? []) as Recipient[];
  }

  // Solo a los que tengan whatsapp configurado.
  recipients = recipients.filter((r) => r.whatsapp);
  if (recipients.length === 0) {
    console.log(
      "[notifyAlarmEvent] no recipients with whatsapp configured",
    );
    return false;
  }

  const text = buildMessage(ev);
  let anySent = false;

  for (const r of recipients) {
    if (!r.whatsapp) continue;
    try {
      const { id: conversationId } = await upsertConversation({
        phone_number: r.whatsapp,
        display_name: r.full_name ?? null,
      });
      const locale = coerceLocale(r.language);
      const tpl = alarmTemplate(ev, locale);
      try {
        let messageId: string | undefined;
        try {
          // Preferimos el template UTILITY: se entrega aunque la ventana
          // 24h esté cerrada (el caso típico de una alarma).
          const res = await sendKapsoTemplateWithFallback({
            phoneNumberId,
            to: r.whatsapp,
            templateName: tpl.name,
            preferredLanguage: locale,
            bodyVariables: tpl.vars,
          });
          messageId = res.messageId;
        } catch (tplErr) {
          // Fallback a texto libre (solo entra dentro de la ventana 24h).
          // Cubre el período en que un template nuevo todavía no está
          // APPROVED en Meta: si el admin escribió hace poco, igual llega.
          console.warn(
            `[notifyAlarmEvent] template ${tpl.name} failed to=${r.whatsapp}: ${(tplErr as Error).message}. Fallback a texto libre.`,
          );
          const res = await sendKapsoText(phoneNumberId, r.whatsapp, text);
          messageId = res.messageId;
        }
        await persistMessage({
          conversation_id: conversationId,
          external_id: messageId ?? null,
          direction: "outbound",
          type: "text",
          body: text,
          status: "sent",
        });
        anySent = true;
        console.log(
          `[notifyAlarmEvent] sent rule=${ev.rule.id} device=${ev.device.property_device_id} to=${r.whatsapp} tpl=${tpl.name}`,
        );
      } catch (sendErr) {
        const reason = (sendErr as Error).message;
        console.warn(
          `[notifyAlarmEvent] send failed to=${r.whatsapp}: ${reason}`,
        );
        try {
          await persistMessage({
            conversation_id: conversationId,
            direction: "outbound",
            type: "text",
            body: text,
            status: "failed",
          });
        } catch {
          /* swallow */
        }
      }
    } catch (e) {
      console.warn(
        "[notifyAlarmEvent] notify pipeline failed:",
        (e as Error).message,
      );
    }
  }

  // Marcar el event como notificado si al menos uno funcionó.
  if (anySent && ev.kind === "fired") {
    await admin
      .from("alarm_events")
      .update({ notified_via_whatsapp: true })
      .eq("id", ev.event_id);
  }

  return anySent;
}
