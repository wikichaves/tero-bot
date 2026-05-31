import { NextRequest, NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getTranslations } from "next-intl/server";
import {
  normalizePhone,
  persistMessage,
  sendKapsoText,
  sendTypingIndicator,
  upsertConversation,
} from "@/lib/whatsapp";
import { parseCommand, runCommand } from "@/lib/whatsapp/commands";
import { buildWelcomeContent } from "@/lib/whatsapp/welcome";
import {
  createTaskFromWhatsApp,
  looksLikeCreateTaskCommand,
  parsePropertyChoiceReply,
  type PropertyChoiceIntent,
} from "@/lib/whatsapp/create-task";
import { handlePreCheckinResponse } from "@/lib/pre-checkin/handle-response";
import { getAdminChatId, sendTelegramMessage } from "@/lib/telegram";
import { createAdminClient } from "@/lib/supabase/admin";
import { APP_NAME } from "@/lib/brand";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import type { Profile } from "@/lib/types";

/**
 * Webhook receiver for Kapso (BSP wrapper around Meta WhatsApp Cloud API).
 *
 * Configure on Kapso side: set webhook URL to
 *   https://<APP_HOST>/api/whatsapp
 * with secret == KAPSO_WEBHOOK_SECRET env var.
 *
 * Behavior:
 *   1. Verify HMAC-SHA256 signature.
 *   2. For each event in the batch: upsert the conversation, persist the
 *      message (idempotent by external_id), record outbound delivery status.
 *   3. For inbound text messages: auto-reply (legacy behavior preserved
 *      while we build the inbox; will be replaced/disabled later).
 *   4. Always 200 if signature valid (so Kapso doesn't retry endlessly).
 */

/**
 * Reply para staff (admin/gestor/mantenimiento) cuando manda algo que no
 * matchea ningún comando. Antes hacíamos silencio total — pero confunde
 * al usuario porque no sabe si el bot lo escuchó. Ahora le respondemos
 * recordándole que mande "ayuda" para ver las opciones. (WIK-89)
 */
async function replyStaffUnknownCommand(locale: Locale): Promise<string> {
  const t = await getTranslations({ locale, namespace: "whatsapp" });
  return t("staffUnknownCommand", { appName: APP_NAME });
}

function isAutoReplyEnabled(): boolean {
  const v = process.env.WHATSAPP_AUTO_REPLY_ENABLED?.toLowerCase();
  // Default ON; only "false"/"0"/"no" disable it.
  return v !== "false" && v !== "0" && v !== "no";
}

function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}

type KapsoTextContent = { body?: string };

type KapsoMessage = {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  text?: KapsoTextContent;
  image?: { link?: string; caption?: string };
  audio?: { link?: string };
  video?: { link?: string };
  timestamp?: string | number;
  kapso?: { direction?: "inbound" | "outbound" };
};

type KapsoStatusError = {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
  href?: string;
};

type KapsoStatus = {
  id?: string;
  status?: string; // sent | delivered | read | failed
  recipient_id?: string;
  // Meta adjunta el motivo SOLO en eventos `failed`. Sin esto, una
  // bienvenida que Meta aceptó (devolvió wamid) pero nunca entregó queda
  // como un misterio (WIK-277): el código de error es la única pista.
  errors?: KapsoStatusError[];
};

type KapsoContact = {
  wa_id?: string;
  profile?: { name?: string };
};

type KapsoEvent = {
  message?: KapsoMessage;
  status?: KapsoStatus;
  contacts?: KapsoContact[];
  phone_number_id?: string;
};

type KapsoWebhookBody = {
  type?: string;
  data?: KapsoEvent[];
};

function extractBody(message: KapsoMessage): string | null {
  if (message.type === "text") return message.text?.body ?? null;
  if (message.type === "image") return message.image?.caption ?? null;
  return null;
}

function extractMediaUrl(message: KapsoMessage): string | null {
  return (
    message.image?.link ??
    message.audio?.link ??
    message.video?.link ??
    null
  );
}

async function processEvent(event: KapsoEvent, eventType: string | null) {
  const phoneNumberId = event.phone_number_id;
  const message = event.message;

  // --- Inbound message ---
  if (
    eventType === "whatsapp.message.received" &&
    message?.from &&
    message?.kapso?.direction === "inbound"
  ) {
    const peer = message.from;
    const displayName = event.contacts?.[0]?.profile?.name ?? null;
    const { id: conversationId, audience } = await upsertConversation({
      phone_number: peer,
      display_name: displayName,
    });
    // Fire the typing indicator concurrently with the persist — best-effort
    // (Meta added the typing_indicator field in late 2024; Kapso may or
    // may not pass it through). Fire for both text and image since both
    // trigger reply work; skip for unsupported types.
    const typingTriggers =
      message.type === "text" || message.type === "image";
    const typingPromise =
      message.id && phoneNumberId && typingTriggers
        ? sendTypingIndicator(phoneNumberId, message.id).catch((err) => {
            console.warn("[kapso typing] failed", err);
          })
        : Promise.resolve();
    const persistPromise = persistMessage({
      conversation_id: conversationId,
      external_id: message.id ?? null,
      direction: "inbound",
      type: message.type ?? "text",
      body: extractBody(message),
      media_url: extractMediaUrl(message),
      raw: event,
    });
    await Promise.all([typingPromise, persistPromise]);
    return {
      conversationId,
      peer,
      phoneNumberId,
      message,
      audience,
      displayName,
    };
  }

  // --- Outbound delivery status updates ---
  const st = event.status;
  if (st?.id) {
    const wamid = st.id;
    const admin = createAdminClient();

    if (st.status === "failed") {
      // Meta ACEPTÓ el envío (devolvió wamid) pero no lo entregó. El motivo
      // viaja en `errors[]` y es la única pista de POR QUÉ no llegó (WIK-277).
      // Lo persistimos en `raw.delivery_error` (merge, para no pisar el
      // payload de envío original) y alertamos al operador — antes este
      // motivo se descartaba y "no llegó" quedaba invisible.
      const reason = st.errors?.[0];
      const { data: row } = await admin
        .from("whatsapp_messages")
        .select("template_name, raw")
        .eq("external_id", wamid)
        .maybeSingle();

      const mergedRaw = {
        ...(row?.raw && typeof row.raw === "object" ? row.raw : {}),
        delivery_error: st.errors ?? null,
      };
      await admin
        .from("whatsapp_messages")
        .update({ status: "failed", raw: mergedRaw })
        .eq("external_id", wamid);

      console.warn(
        `[kapso status] failed wamid=${wamid} recipient=${st.recipient_id ?? "?"} ` +
          `template=${row?.template_name ?? "?"} code=${reason?.code ?? "?"} ` +
          `title=${reason?.title ?? reason?.message ?? "?"}`,
      );

      await notifyAdminDeliveryFailure({
        wamid,
        recipient: st.recipient_id ?? null,
        templateName: row?.template_name ?? null,
        code: reason?.code ?? null,
        title: reason?.title ?? reason?.message ?? null,
        details: reason?.error_data?.details ?? null,
      }).catch((err) =>
        console.warn("[kapso status] admin alert failed", err),
      );
    } else {
      // sent | delivered | read — update if we have the row (outbound sent
      // from outside this app won't match; ignore silently).
      await admin
        .from("whatsapp_messages")
        .update({ status: st.status ?? null })
        .eq("external_id", wamid);
    }
  }

  return null;
}

/**
 * Avisa al operador por Telegram cuando Meta reporta que un outbound
 * `failed` — un mensaje que Meta aceptó (hay wamid) pero no entregó. El
 * código de Meta dice el motivo (ej. 131049 = limitado por engagement,
 * 131026 = número no es WhatsApp / no recibe). Best-effort: no throws.
 */
async function notifyAdminDeliveryFailure(opts: {
  wamid: string;
  recipient: string | null;
  templateName: string | null;
  code: number | null;
  title: string | null;
  details: string | null;
}): Promise<void> {
  const chatId = getAdminChatId();
  if (!chatId) return;
  const lines = [
    `⚠️ WhatsApp no entregado (Meta lo aceptó pero falló la entrega)`,
    opts.templateName ? `Template: ${opts.templateName}` : null,
    opts.recipient ? `Destino: ${opts.recipient}` : null,
    `Motivo Meta: ${opts.code ?? "?"}${opts.title ? ` — ${opts.title}` : ""}`,
    opts.details ? `Detalle: ${opts.details}` : null,
    `wamid: ${opts.wamid}`,
  ].filter(Boolean);
  await sendTelegramMessage({ chatId, text: lines.join("\n") });
}

async function sendAndPersist(opts: {
  phoneNumberId: string;
  peer: string;
  conversationId: string;
  text: string;
  /** Optional structured intent to persist on the outbound message. The
   *  next inbound reply may match against it (see PropertyChoiceIntent). */
  intent?: unknown;
}) {
  const { messageId } = await sendKapsoText(
    opts.phoneNumberId,
    opts.peer,
    opts.text,
  );
  await persistMessage({
    conversation_id: opts.conversationId,
    external_id: messageId ?? null,
    direction: "outbound",
    type: "text",
    body: opts.text,
    status: "sent",
    raw: opts.intent ?? null,
  });
}

/**
 * Look up a profile by WA phone number using the admin client. Used to
 * authenticate task-creation requests before we accept them.
 */
async function lookupProfileByPhone(phone: string): Promise<Profile | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("*")
    .eq("whatsapp", normalized)
    .maybeSingle();
  return (data as Profile) ?? null;
}

/**
 * Fetch all properties (id+name only) — pre-warmed in parallel with the
 * profile lookup so create-task doesn't pay the DB roundtrip serially.
 */
async function fetchPropertiesForCreate(): Promise<
  { id: string; name: string }[]
> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("properties")
    .select("id, name")
    .order("name");
  return data ?? [];
}

/**
 * Look up the latest outbound message in this conversation that has a
 * "create-task-property-choice" intent stored in its `raw` field. Used
 * when the user replies with a number — we match it against the options
 * we just offered. Returns null if no recent prompt is pending or it's
 * older than 10 minutes (treat as expired).
 */
async function findPendingPropertyChoice(
  conversationId: string,
): Promise<PropertyChoiceIntent | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("whatsapp_messages")
    .select("sent_at, raw")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.raw) return null;
  const raw = data.raw as { intent?: string };
  if (raw.intent !== "create-task-property-choice") return null;
  const sentAt = new Date(data.sent_at as string).getTime();
  if (Date.now() - sentAt > 10 * 60 * 1000) return null; // 10min expiry
  return data.raw as PropertyChoiceIntent;
}

async function autoReply(opts: {
  phoneNumberId: string;
  peer: string;
  conversationId: string;
  audience: "guest" | "staff" | "unknown";
  displayName: string | null;
  messageType: string;
  messageBody: string | null;
  mediaUrl: string | null;
}) {
  if (!isAutoReplyEnabled()) return;

  // WIK-151: resolver el locale del recipient antes que cualquier respuesta
  // free-form. Si no hay profile (guest/unknown), default `en`. Cacheamos
  // el profile lookup en `cachedProfile` para no pegarle 3 veces al DB.
  let cachedProfile: Profile | null | undefined = undefined;
  const getProfile = async (): Promise<Profile | null> => {
    if (cachedProfile !== undefined) return cachedProfile;
    cachedProfile = await lookupProfileByPhone(opts.peer);
    return cachedProfile;
  };
  const getLocale = async (): Promise<Locale> => {
    const p = await getProfile();
    const lang = p?.language;
    return lang && isLocale(lang) ? lang : DEFAULT_LOCALE;
  };

  // 0) Numbered selection reply — if user previously got a "qué propiedad?"
  // prompt, a short reply like "1" / "2" / "0" picks (or cancels) that
  // pending create-task. Has to run BEFORE the create-task triggers below
  // so `tareas`-like keywords don't accidentally re-fire instead.
  if (opts.messageType === "text") {
    const selection = parsePropertyChoiceReply(opts.messageBody);
    if (selection !== null) {
      const pending = await findPendingPropertyChoice(opts.conversationId);
      if (pending) {
        const locale = await getLocale();
        const tCreate = await getTranslations({
          locale,
          namespace: "whatsapp.createTask",
        });
        if (selection === 0) {
          await sendAndPersist({
            phoneNumberId: opts.phoneNumberId,
            peer: opts.peer,
            conversationId: opts.conversationId,
            text: tCreate("cancelled"),
          });
          return;
        }
        const idx = selection - 1;
        if (idx < 0 || idx >= pending.properties.length) {
          await sendAndPersist({
            phoneNumberId: opts.phoneNumberId,
            peer: opts.peer,
            conversationId: opts.conversationId,
            text: tCreate("invalidChoice", {
              max: pending.properties.length,
            }),
          });
          return;
        }
        const profile = await getProfile();
        if (!profile) {
          // Edge case: profile was removed between prompt and reply.
          return;
        }
        try {
          const result = await createTaskFromWhatsApp({
            profile,
            text: pending.text,
            mediaUrl: pending.mediaUrl,
            prefetchedProperties: pending.properties,
            forcePropertyId: pending.properties[idx].id,
            locale,
          });
          await sendAndPersist({
            phoneNumberId: opts.phoneNumberId,
            peer: opts.peer,
            conversationId: opts.conversationId,
            text: result.reply,
          });
        } catch (err) {
          console.error("[kapso property-choice] error", err);
        }
        return;
      }
    }
  }

  // 0.5) Pre-checkin alert response handler (WIK-125). Looks for pending
  // alerts visible to the sender and matches "Sí, prender" / "No, gracias"
  // / "si bosque" / "no julio" patterns. Runs BEFORE generic command
  // parsing because "si"/"no" otherwise hit nothing useful.
  if (opts.messageType === "text" && opts.messageBody) {
    try {
      const r = await handlePreCheckinResponse({
        fromPhone: opts.peer,
        text: opts.messageBody,
      });
      if (r.handled) {
        await sendAndPersist({
          phoneNumberId: opts.phoneNumberId,
          peer: opts.peer,
          conversationId: opts.conversationId,
          text: r.reply_text,
        });
        return;
      }
    } catch (err) {
      console.error("[pre-checkin response] error", err);
      // Fall through to other handlers.
    }
  }

  // 1) Photo from a registered profile → auto-create a task
  // 2) Text starting with `tarea …` from a registered profile → create task
  // (We look up the profile once and reuse it.)
  const wantsCreate =
    opts.messageType === "image" ||
    looksLikeCreateTaskCommand(opts.messageBody);
  if (wantsCreate) {
    // Profile lookup AND properties fetch run in parallel — they're
    // independent and the create-task path needs both. Saves one
    // DB roundtrip of latency.
    const startedAt = Date.now();
    const [profile, properties] = await Promise.all([
      getProfile(),
      fetchPropertiesForCreate(),
    ]);
    if (profile) {
      try {
        const result = await createTaskFromWhatsApp({
          profile,
          text: opts.messageBody,
          mediaUrl: opts.mediaUrl,
          prefetchedProperties: properties,
          locale: await getLocale(),
        });
        await sendAndPersist({
          phoneNumberId: opts.phoneNumberId,
          peer: opts.peer,
          conversationId: opts.conversationId,
          text: result.reply,
          // If create-task is asking for a property pick, persist the
          // intent so the user's next reply can match against it.
          intent: !result.ok ? result.pendingIntent : undefined,
        });
        console.log(
          `[kapso autoReply] create-task ${opts.peer} took ${Date.now() - startedAt}ms`,
        );
        return;
      } catch (err) {
        console.error("[kapso create-task] error", err);
        // Fall through to default reply if creation crashed unexpectedly.
      }
    } else if (opts.messageType === "image") {
      // Photo from an unknown sender — don't auto-create. Fall through to
      // the default guest/unknown auto-reply below.
    } else {
      // Text-based create attempt from an unknown sender → tell them.
      const normalized = normalizePhone(opts.peer) ?? opts.peer;
      const locale = await getLocale();
      const tCreate = await getTranslations({
        locale,
        namespace: "whatsapp.createTask",
      });
      await sendAndPersist({
        phoneNumberId: opts.phoneNumberId,
        peer: opts.peer,
        conversationId: opts.conversationId,
        text: tCreate("unlinkedSender", { phone: normalized }),
      });
      return;
    }
  }

  // Try to handle as a regular command (consumo, tareas, ayuda).
  const command = parseCommand(opts.messageBody);

  // WIK-278: activación de operador. El operador nuevo abre la ventana de 24h
  // con el link click-to-chat ("activar mi acceso"); respondemos con la
  // bienvenida como mensaje de sesión free-form. Dentro de la ventana la
  // entrega es confiable — evita el throttling de Meta a los templates
  // business-initiated hacia números que nunca interactuaron (ver WIK-277).
  if (command?.type === "activate") {
    const locale = await getLocale();
    const tWelcome = await getTranslations({
      locale,
      namespace: "whatsapp.staffWelcome",
    });
    const profile = await getProfile();
    if (!profile) {
      const normalized = normalizePhone(opts.peer) ?? opts.peer;
      await sendAndPersist({
        phoneNumberId: opts.phoneNumberId,
        peer: opts.peer,
        conversationId: opts.conversationId,
        text: tWelcome("notLinked", { phone: normalized }),
      });
      return;
    }
    const { firstName, propertyList } = await buildWelcomeContent(profile);
    await sendAndPersist({
      phoneNumberId: opts.phoneNumberId,
      peer: opts.peer,
      conversationId: opts.conversationId,
      text: tWelcome("session", {
        name: firstName,
        properties: propertyList,
      }),
    });
    return;
  }

  if (command) {
    try {
      const reply = await runCommand(command, opts.peer, await getLocale());
      if (reply) {
        await sendAndPersist({
          phoneNumberId: opts.phoneNumberId,
          peer: opts.peer,
          conversationId: opts.conversationId,
          text: reply,
        });
        return;
      }
    } catch (err) {
      console.error("[kapso command] error", err);
    }
  }

  // (WIK-89) Antes el staff caía en silencio total para mensajes
  // no-comando — generaba confusión porque parecía que el bot no
  // escuchaba. Ahora le respondemos con un hint para que sepa que
  // recibimos pero no entendimos.
  //
  // WIK-235: quitamos la autorespuesta "gracias por escribir…
  // te respondemos a la brevedad" para guest/unknown. Ahora caen en
  // silencio (el operador responde manualmente desde el inbox). Solo el
  // staff sigue recibiendo el hint de comandos.
  if (opts.audience !== "staff") return;

  const locale = await getLocale();
  const text = await replyStaffUnknownCommand(locale);

  try {
    await sendAndPersist({
      phoneNumberId: opts.phoneNumberId,
      peer: opts.peer,
      conversationId: opts.conversationId,
      text,
    });
  } catch (err) {
    console.error("[kapso autoReply] error", err);
  }
}

export async function POST(req: NextRequest) {
  const meta = {
    event: req.headers.get("x-webhook-event"),
    signature: req.headers.get("x-webhook-signature"),
    idempotencyKey: req.headers.get("x-idempotency-key"),
    batch: req.headers.get("x-webhook-batch"),
    batchSize: req.headers.get("x-batch-size"),
  };

  const rawBody = await req.text();

  // Signature validation.
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (secret) {
    if (!meta.signature) {
      console.warn("[kapso webhook] missing X-Webhook-Signature header");
      return NextResponse.json(
        { error: "missing signature" },
        { status: 401 },
      );
    }
    if (!verifySignature(rawBody, meta.signature, secret)) {
      console.warn("[kapso webhook] invalid signature", {
        idempotencyKey: meta.idempotencyKey,
      });
      return NextResponse.json(
        { error: "invalid signature" },
        { status: 401 },
      );
    }
  } else {
    console.warn(
      "[kapso webhook] KAPSO_WEBHOOK_SECRET not set — skipping signature verification",
    );
  }

  let body: KapsoWebhookBody | string;
  try {
    body = JSON.parse(rawBody) as KapsoWebhookBody;
  } catch {
    body = rawBody;
  }

  if (typeof body !== "object" || !Array.isArray(body.data)) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Process events; collect inbound text + image events so we can auto-reply
  // once the persistence is committed. Images get the create-task flow when
  // the sender is a known profile; text gets command/auto-reply handling.
  const replyTargets: Array<{
    phoneNumberId: string;
    peer: string;
    conversationId: string;
    audience: "guest" | "staff" | "unknown";
    displayName: string | null;
    messageType: string;
    messageBody: string | null;
    mediaUrl: string | null;
  }> = [];

  await Promise.allSettled(
    body.data.map(async (event) => {
      try {
        const result = await processEvent(event, meta.event);
        if (!result || !result.phoneNumberId) return;
        const messageType = result.message?.type ?? "text";
        if (messageType !== "text" && messageType !== "image") return;
        replyTargets.push({
          phoneNumberId: result.phoneNumberId,
          peer: result.peer,
          conversationId: result.conversationId,
          audience: result.audience,
          displayName: result.displayName,
          messageType,
          messageBody: result.message ? extractBody(result.message) : null,
          mediaUrl: result.message ? extractMediaUrl(result.message) : null,
        });
      } catch (err) {
        console.error("[kapso webhook] processEvent error", err);
      }
    }),
  );

  // Fire-and-forget auto-replies via after(): the webhook responds 200 to
  // Kapso immediately, then the slow work (DB lookups + Kapso send) happens
  // in the background. The user has already seen "escribiendo…" by now via
  // the typing indicator we sent during processEvent.
  if (replyTargets.length > 0) {
    after(async () => {
      console.time("[kapso] autoReply batch");
      await Promise.allSettled(replyTargets.map(autoReply));
      console.timeEnd("[kapso] autoReply batch");
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
