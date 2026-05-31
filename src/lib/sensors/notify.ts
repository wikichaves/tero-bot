import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_HOST } from "@/lib/brand";
import {
  persistMessage,
  sendKapsoText,
  upsertConversation,
} from "@/lib/whatsapp/index";
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
 *   - Si el send falla (ventana 24h cerrada, error de Kapso, etc.) el
 *     mensaje queda persisted en la inbox con status=failed para que
 *     admin pueda ver el intento. Marca `notified_via_whatsapp=false`.
 *   - Si el send funciona en al menos un destinatario, marca
 *     `notified_via_whatsapp=true` (uno notificado es suficiente — no
 *     queremos volver a intentar si después conectamos a otro admin).
 *
 * Out of scope V1: rate limiting per recipient, templates para casos
 * fuera de la ventana 24h. Para un operator con 1-2 admins activos en
 * WA, no hace falta todavía.
 */

function emojiFor(metric: "temperature_c" | "humidity_pct"): string {
  return metric === "temperature_c" ? "🌡️" : "💧";
}

function unitOf(metric: "temperature_c" | "humidity_pct"): string {
  return metric === "temperature_c" ? "°C" : "%";
}

function labelOf(metric: "temperature_c" | "humidity_pct"): string {
  return metric === "temperature_c" ? "Temperatura" : "Humedad";
}

function buildMessage(ev: EvaluatedEvent): string {
  const m = ev.rule.metric;
  const op = ev.rule.operator === "gt" ? ">" : "<";
  const valStr = m === "temperature_c"
    ? `${ev.value.toFixed(1)}${unitOf(m)}`
    : `${ev.value.toFixed(0)}${unitOf(m)}`;
  const thrStr = m === "temperature_c"
    ? `${ev.rule.threshold.toFixed(1)}${unitOf(m)}`
    : `${ev.rule.threshold.toFixed(0)}${unitOf(m)}`;
  const location = ev.device.room_name
    ? `${ev.device.room_name} (${ev.device.property_name ?? "—"})`
    : (ev.device.property_name ?? "—");
  const sensorLine = ev.device.device_name
    ? `\n_Sensor: ${ev.device.device_name}_`
    : "";

  if (ev.kind === "fired") {
    return (
      `🚨 *Alarma ${labelOf(m).toLowerCase()}*\n\n` +
      `${emojiFor(m)} *${valStr}* en *${location}*\n` +
      `Umbral: ${op} ${thrStr}` +
      sensorLine +
      `\n\n_Ver detalle: ${APP_HOST}/rooms_`
    );
  }
  // resolved
  return (
    `✅ *Alarma resuelta*\n\n` +
    `${emojiFor(m)} ${labelOf(m)} volvió a *${valStr}* en *${location}* ` +
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
  };

  // WIK-275: destinatarios asignados explícitamente a la regla.
  const { data: assignedRows, error: assignedErr } = await admin
    .from("alarm_rule_recipients")
    .select("profile:profiles(id, full_name, whatsapp, role)")
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
      .select("id, full_name, whatsapp, role")
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
      try {
        const { messageId } = await sendKapsoText(phoneNumberId, r.whatsapp, text);
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
          `[notifyAlarmEvent] sent rule=${ev.rule.id} device=${ev.device.property_device_id} to=${r.whatsapp}`,
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
