import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_HOST } from "@/lib/brand";
import {
  persistMessage,
  sendKapsoTemplateWithFallback,
  upsertConversation,
} from "@/lib/whatsapp/index";
import { sendPushToProfiles, type PushPayload } from "@/lib/push";
import {
  escapeHtml,
  getAdminChatId,
  getOpsBotToken,
  sendTelegramMessage,
} from "@/lib/telegram";
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
 * Construye el payload de push para un evento de alarma (WIK-311). Texto
 * plano (la notificación nativa no entiende el markdown de WhatsApp).
 * `tag` colapsa el "fired" y el "resolved" de la misma regla en una sola
 * notificación en el SO.
 */
function pushForEvent(ev: EvaluatedEvent): PushPayload {
  const location = ev.device.room_name
    ? `${ev.device.room_name} · ${ev.device.property_name ?? "—"}`
    : (ev.device.property_name ?? "—");
  const tag = `alarm-${ev.rule.id}`;

  if (ev.rule.metric === "power_outage") {
    const property = ev.device.property_name ?? location;
    return ev.kind === "fired"
      ? {
          title: `⚡ Corte de luz en ${property}`,
          body: "La llave reportó falta de tensión.",
          url: "/rooms",
          tag,
        }
      : {
          title: `✅ Volvió la luz en ${property}`,
          body: "La llave de luz se reconectó.",
          url: "/rooms",
          tag,
        };
  }

  const label = labelOf(ev.rule.metric);
  const value = ev.value ?? 0;
  const unit = unitOf(ev.rule.metric);
  const valStr =
    ev.rule.metric === "temperature_c"
      ? `${value.toFixed(1)}${unit}`
      : `${value.toFixed(0)}${unit}`;
  return ev.kind === "fired"
    ? {
        title: `🔔 Alarma de ${label.toLowerCase()} — ${location}`,
        body: `${valStr} (umbral ${ev.rule.operator === "gt" ? ">" : "<"} ${
          ev.rule.threshold ?? 0
        }${unit})`,
        url: "/rooms",
        tag,
      }
    : {
        title: `✅ Alarma resuelta — ${location}`,
        body: `${label} volvió a ${valStr}.`,
        url: "/rooms",
        tag,
      };
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
  // WIK-321: antes esto hacía un early-return y se saltaba TODA la
  // notificación. Ahora WhatsApp es sólo uno de los canales: si no está
  // configurado, push y Telegram salen igual.
  const whatsappConfigured = !!(phoneNumberId && apiKey);
  if (!whatsappConfigured) {
    console.log(
      "[notifyAlarmEvent] WhatsApp env no configurado — sólo push + Telegram",
    );
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

  // WIK-311: push a la PWA de cada destinatario (independiente de WhatsApp —
  // va a todos los profiles asignados, tengan o no `whatsapp`). Best-effort.
  try {
    await sendPushToProfiles(
      recipients.map((r) => r.id),
      pushForEvent(ev),
    );
  } catch (e) {
    console.warn(`[notifyAlarmEvent] push failed: ${(e as Error).message}`);
  }

  // WIK-321: Telegram como canal de primera clase para las alarmas.
  //
  // Motivo: WhatsApp depende de que la WABA tenga la facturación de Meta
  // configurada. Con ese bloqueo activo ("Business eligibility payment
  // issue"), TODOS los envíos salientes fallan y las alarmas no llegan.
  // Telegram no tiene ventana de 24h, ni templates que aprobar, ni
  // facturación — así que sirve de canal garantizado y de respaldo
  // permanente aunque WhatsApp vuelva a funcionar.
  //
  // Va al chat admin (TELEGRAM_ADMIN_CHAT_ID), igual que los alerts de cron.
  // Best-effort: nunca rompe el flujo de WhatsApp/push.
  let telegramSent = false;
  try {
    const chatId = getAdminChatId();
    if (chatId) {
      const p = pushForEvent(ev);
      const res = await sendTelegramMessage({
        chatId,
        text:
          `<b>${escapeHtml(p.title)}</b>\n\n${escapeHtml(p.body)}\n\n` +
          `<a href="https://${APP_HOST}/rooms">Ver ambientes</a>`,
        parseMode: "HTML",
        disableWebPagePreview: true,
      });
      telegramSent = res != null;
      if (telegramSent) {
        console.log(
          `[notifyAlarmEvent] telegram sent rule=${ev.rule.id} kind=${ev.kind}`,
        );
      }
    }
  } catch (e) {
    console.warn(`[notifyAlarmEvent] telegram failed: ${(e as Error).message}`);
  }

  // WIK-285: además del chat admin, mandamos la alarma por el bot de OPS
  // (@tero_ops_bot) a cada admin/gestor con telegram_chat_id registrado.
  // Así Agus/Mónica reciben las alarmas en Telegram sin depender de
  // WhatsApp ni de un único chat admin. Best-effort.
  try {
    const opsToken = getOpsBotToken();
    if (opsToken) {
      const p = pushForEvent(ev);
      const text =
        `<b>${escapeHtml(p.title)}</b>\n\n${escapeHtml(p.body)}\n\n` +
        `<a href="https://${APP_HOST}/rooms">Ver ambientes</a>`;
      const { data: opsRows } = await admin
        .from("profiles")
        .select("telegram_chat_id")
        .in("role", ["admin", "gestor"])
        .not("telegram_chat_id", "is", null);
      const chatIds = Array.from(
        new Set(
          (opsRows ?? [])
            .map((r) => (r as { telegram_chat_id: number | null }).telegram_chat_id)
            .filter((v): v is number => typeof v === "number"),
        ),
      );
      for (const cid of chatIds) {
        const res = await sendTelegramMessage({
          token: opsToken,
          chatId: cid,
          text,
          parseMode: "HTML",
          disableWebPagePreview: true,
        });
        if (res != null) {
          telegramSent = true;
        }
      }
      if (chatIds.length > 0) {
        console.log(
          `[notifyAlarmEvent] ops-bot telegram sent to ${chatIds.length} recipient(s) rule=${ev.rule.id} kind=${ev.kind}`,
        );
      }
    }
  } catch (e) {
    console.warn(`[notifyAlarmEvent] ops-bot telegram failed: ${(e as Error).message}`);
  }

  // Solo a los que tengan whatsapp configurado.
  recipients = recipients.filter((r) => r.whatsapp);
  // WIK-321: sin destinatarios de WhatsApp (o sin config) igual dimos aviso
  // por push + Telegram, así que devolvemos `telegramSent` en vez de false —
  // un `false` acá haría que el evento se reintente como si nadie se hubiera
  // enterado.
  if (!whatsappConfigured || recipients.length === 0) {
    if (recipients.length === 0) {
      console.log("[notifyAlarmEvent] no recipients with whatsapp configured");
    }
    if (telegramSent && ev.kind === "fired") {
      await admin
        .from("alarm_events")
        .update({ notified_via_whatsapp: true })
        .eq("id", ev.event_id);
    }
    return telegramSent;
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
        // WIK-316: registrar si salió por template o por el fallback de texto
        // libre. Antes se persistía siempre `type: "text"` sin
        // `template_name`, así que en la inbox era imposible distinguir un
        // envío por template de uno por texto — y "no llegó" quedaba
        // indiagnosticable desde la app.
        let sentViaTemplate = false;
        // WIK-284: SOLO template UTILITY para alarmas. Los cuatro templates
        // de alarma (sensor_alarm_fired_v2/_resolved, power_outage_*) están
        // APPROVED en es/en, así que el template SIEMPRE es la vía correcta:
        // se entrega aunque la ventana 24h esté cerrada (el caso típico).
        //
        // Antes caíamos a texto libre si el template fallaba. Pero para una
        // alarma el destinatario casi nunca escribió en las últimas 24h, así
        // que el texto libre NO entra: Meta lo rechaza con 131047
        // ("Re-engagement message") y eso disparaba un aviso de fallo confuso
        // al admin. El fallback era inútil y solo generaba ruido.
        //
        // Ahora: 1 retry del template ante fallo transitorio (timeout/hipo de
        // red de Kapso/Meta). Si el retry también falla, dejamos que el error
        // propague al catch de abajo (persist failed + log), sin texto libre.
        {
          let lastErr: unknown;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              // Se entrega aunque la ventana 24h esté cerrada.
              const res = await sendKapsoTemplateWithFallback({
                phoneNumberId,
                to: r.whatsapp,
                templateName: tpl.name,
                preferredLanguage: locale,
                bodyVariables: tpl.vars,
              });
              messageId = res.messageId;
              sentViaTemplate = true;
              break;
            } catch (tplErr) {
              lastErr = tplErr;
              if (attempt < 2) {
                console.warn(
                  `[notifyAlarmEvent] template ${tpl.name} failed to=${r.whatsapp} (attempt ${attempt}/2): ${(tplErr as Error).message}. Reintentando.`,
                );
                await new Promise((r) => setTimeout(r, 800));
              }
            }
          }
          if (!sentViaTemplate) {
            // Sin fallback a texto libre: para una alarma fuera de ventana
            // 24h nunca entraría (131047). Propagamos al catch de abajo.
            throw lastErr;
          }
        }
        await persistMessage({
          conversation_id: conversationId,
          external_id: messageId ?? null,
          direction: "outbound",
          type: sentViaTemplate ? "template" : "text",
          template_name: sentViaTemplate ? tpl.name : null,
          body: text,
          // "accepted" = Meta devolvió wamid; el webhook de status lo pasa a
          // sent/delivered/failed. Antes lo marcábamos "sent" de entrada, lo
          // que hacía indistinguible "Meta lo aceptó" de "Meta lo entregó".
          status: messageId ? "accepted" : "sent",
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

  // Marcar el event como notificado si al menos un canal funcionó (WIK-321:
  // Telegram cuenta — el operador se enteró aunque WhatsApp esté bloqueado).
  if ((anySent || telegramSent) && ev.kind === "fired") {
    await admin
      .from("alarm_events")
      .update({ notified_via_whatsapp: true })
      .eq("id", ev.event_id);
  }

  return anySent || telegramSent;
}


/**
 * WIK-322: notificación AGRUPADA de alarmas.
 *
 * Problema: el cron de snapshots evalúa todos los sensores en un mismo run.
 * Si varios cruzan el umbral a la vez (típico: madrugada fría, corte de luz
 * que afecta 4 casas), se disparaban N eventos y se mandaba 1 notificación
 * por cada uno → 7 mensajes seguidos al mismo destinatario en el mismo
 * minuto. Ruido.
 *
 * Solución: agrupar los eventos de un run y mandar UN solo mensaje por canal
 * de texto libre (Telegram admin + ops-bot, push). Para 1 solo evento el
 * mensaje es idéntico al de antes (no hay regresión visual).
 *
 * WhatsApp queda por-evento (usa templates UTILITY con variables fijas; no
 * hay template "resumen"). Pero: (a) hoy WhatsApp está bloqueado por billing,
 * y (b) el ruido real lo generaban Telegram/push, que son los canales vivos.
 * Igual, para no reintroducir el spam por WhatsApp, si hay >1 evento fired
 * mandamos UN solo template "resumen" al primer canal disponible... no: no
 * existe ese template. Mantenemos WhatsApp por-evento SOLO cuando hay 1
 * evento; con múltiples, WhatsApp manda el batch como texto (entra si la
 * ventana 24h está abierta) para no disparar N templates. Ver nota abajo.
 *
 * Best-effort: nunca tira. Marca notified_via_whatsapp=true en los eventos
 * fired si algún canal funcionó.
 */
export async function notifyAlarmEventsBatch(
  events: EvaluatedEvent[],
): Promise<boolean> {
  if (events.length === 0) return false;
  // 1 solo evento → comportamiento histórico exacto (sin cambios).
  if (events.length === 1) return notifyAlarmEvent(events[0]);

  const admin = createAdminClient();

  // Texto agrupado para canales de texto libre (Telegram + push body).
  // Separamos fired de resolved para un encabezado claro.
  const fired = events.filter((e) => e.kind === "fired");
  const resolved = events.filter((e) => e.kind === "resolved");

  function lineFor(ev: EvaluatedEvent): string {
    const loc = ev.device.room_name
      ? `${ev.device.room_name} · ${ev.device.property_name ?? "—"}`
      : (ev.device.property_name ?? "—");
    if (ev.rule.metric === "power_outage") {
      return ev.kind === "fired"
        ? `⚡ Corte de luz — ${ev.device.property_name ?? loc}`
        : `✅ Volvió la luz — ${ev.device.property_name ?? loc}`;
    }
    const m = ev.rule.metric;
    const unit = unitOf(m);
    const value = ev.value ?? 0;
    const valStr =
      m === "temperature_c" ? `${value.toFixed(1)}${unit}` : `${value.toFixed(0)}${unit}`;
    const op = ev.rule.operator === "gt" ? ">" : "<";
    const thr = ev.rule.threshold ?? 0;
    const thrStr =
      m === "temperature_c" ? `${thr.toFixed(1)}${unit}` : `${thr.toFixed(0)}${unit}`;
    return ev.kind === "fired"
      ? `🔔 ${labelOf(m)} ${valStr} — ${loc} (umbral ${op} ${thrStr})`
      : `✅ ${labelOf(m)} normalizada ${valStr} — ${loc}`;
  }

  const titleParts: string[] = [];
  if (fired.length > 0) titleParts.push(`${fired.length} alarma(s) activa(s)`);
  if (resolved.length > 0) titleParts.push(`${resolved.length} resuelta(s)`);
  const title = titleParts.join(" · ");

  const bodyLines: string[] = [];
  for (const ev of [...fired, ...resolved]) bodyLines.push(lineFor(ev));
  const plainBody = bodyLines.join("\n");

  // Push: title + body plano, tag único del run para colapsar.
  try {
    // Destinatarios = union de los recipients de todas las reglas
    // involucradas + fallback admin/gestor. Para push mandamos a todos los
    // admin/gestor (mismo criterio que el fallback histórico) — simple y
    // cubre el caso real (pocas personas).
    const { data: profs } = await admin
      .from("profiles")
      .select("id, role")
      .in("role", ["admin", "gestor"]);
    const ids = (profs ?? []).map((p) => (p as { id: string }).id);
    if (ids.length > 0) {
      await sendPushToProfiles(ids, {
        title: `🏠 ${title}`,
        body: plainBody,
        url: "/rooms",
        tag: `alarm-batch-${Date.now()}`,
      });
    }
  } catch (e) {
    console.warn(`[notifyAlarmEventsBatch] push failed: ${(e as Error).message}`);
  }

  // Telegram admin + ops-bot: UN mensaje HTML con todas las líneas.
  const htmlBody =
    `<b>🏠 ${escapeHtml(title)}</b>\n\n` +
    bodyLines.map((l) => escapeHtml(l)).join("\n") +
    `\n\n<a href="https://${APP_HOST}/rooms">Ver ambientes</a>`;
  let telegramSent = false;
  try {
    const chatId = getAdminChatId();
    if (chatId) {
      const res = await sendTelegramMessage({
        chatId,
        text: htmlBody,
        parseMode: "HTML",
        disableWebPagePreview: true,
      });
      telegramSent = res != null;
    }
  } catch (e) {
    console.warn(`[notifyAlarmEventsBatch] telegram admin failed: ${(e as Error).message}`);
  }
  try {
    const opsToken = getOpsBotToken();
    if (opsToken) {
      const { data: opsRows } = await admin
        .from("profiles")
        .select("telegram_chat_id")
        .in("role", ["admin", "gestor"])
        .not("telegram_chat_id", "is", null);
      const chatIds = Array.from(
        new Set(
          (opsRows ?? [])
            .map((r) => (r as { telegram_chat_id: number | null }).telegram_chat_id)
            .filter((v): v is number => typeof v === "number"),
        ),
      );
      for (const cid of chatIds) {
        const res = await sendTelegramMessage({
          token: opsToken,
          chatId: cid,
          text: htmlBody,
          parseMode: "HTML",
          disableWebPagePreview: true,
        });
        if (res != null) telegramSent = true;
      }
    }
  } catch (e) {
    console.warn(`[notifyAlarmEventsBatch] ops-bot telegram failed: ${(e as Error).message}`);
  }

  // WhatsApp: para no re-spamear N templates, con batch NO mandamos WhatsApp
  // por-evento. El canal está bloqueado por billing hoy y el valor del batch
  // está en Telegram/push. Cuando WhatsApp vuelva, se puede sumar un template
  // "resumen" (fuera de scope acá). Igual marcamos los fired como notificados
  // si algún canal de texto libre funcionó.
  if (telegramSent) {
    const firedIds = fired.map((e) => e.event_id);
    if (firedIds.length > 0) {
      await admin
        .from("alarm_events")
        .update({ notified_via_whatsapp: true })
        .in("id", firedIds);
    }
  }
  console.log(
    `[notifyAlarmEventsBatch] ${events.length} eventos agrupados (fired=${fired.length} resolved=${resolved.length}) telegramSent=${telegramSent}`,
  );
  return telegramSent;
}
