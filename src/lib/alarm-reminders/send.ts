import "server-only";
import { format, parseISO } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendKapsoTemplateWithFallback } from "@/lib/whatsapp";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import type { AlarmCandidate } from "./find-due";

/**
 * Send the WhatsApp alarm reminder for a single candidate (WIK-124).
 * Used by the `/api/cron/alarm-reminders` route — one call per candidate.
 *
 * On success, inserts a row in `alarm_notifications_sent` so the same
 * candidate doesn't re-fire in subsequent cron runs. On failure, logs
 * and returns the error WITHOUT inserting — that way the next cron run
 * will retry (Kapso transient errors get a second chance).
 *
 * The template names (`task_reminder`, `reservation_checkin_reminder`)
 * must be APPROVED in Meta before this works in production. If the
 * `MOCK_WHATSAPP_TEMPLATES` env is set to "true", we log instead of
 * sending — useful pre-approval to validate the cron logic end-to-end.
 */

export type SendResult = {
  candidate: AlarmCandidate;
  ok: boolean;
  error?: string;
  mocked?: boolean;
};

function coerceLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

function formatWhen(
  targetIso: string,
  alarmIso: string,
  locale: Locale,
): string {
  const target = parseISO(targetIso);
  const alarm = parseISO(alarmIso);
  const hoursLeft = Math.round(
    (target.getTime() - alarm.getTime()) / (60 * 60 * 1000),
  );
  // Si la alarma sale "en redondo" (1h, 2h, 4h…) preferimos texto natural;
  // si no, mostrar la hora absoluta para no engañar.
  if (hoursLeft > 0 && hoursLeft <= 12) {
    if (locale === "en") {
      return `in ${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"}`;
    }
    return `en ${hoursLeft} ${hoursLeft === 1 ? "hora" : "horas"}`;
  }
  if (locale === "en") {
    return `on ${format(target, "EEEE MMMM d 'at' HH:mm", { locale: enUS })}`;
  }
  return `el ${format(target, "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })}`;
}

export async function sendAlarmReminder(
  candidate: AlarmCandidate,
): Promise<SendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const isMock = process.env.MOCK_WHATSAPP_TEMPLATES === "true";
  const admin = createAdminClient();

  // Build the template name + body variables per kind. Recipient's
  // `profile.language` decides whether we render EN or ES strings — the
  // template registry has matching (name, language) pairs for both.
  let templateName: string;
  let bodyVariables: string[];
  let toPhone: string;
  let recipientLocale: Locale;
  if (candidate.kind === "task") {
    templateName = "task_reminder";
    recipientLocale = coerceLocale(candidate.assignee_language);
    bodyVariables = [
      candidate.title,
      candidate.property_name ?? "—",
      formatWhen(candidate.due_at_iso, candidate.alarm_at_iso, recipientLocale),
    ];
    toPhone = candidate.assignee_phone;
  } else {
    templateName = "reservation_checkin_reminder";
    recipientLocale = coerceLocale(candidate.notify_language);
    bodyVariables = [
      candidate.guest_name ?? (recipientLocale === "en" ? "Guest" : "Huésped"),
      candidate.property_name ?? "—",
      formatWhen(
        candidate.check_in_at_iso,
        candidate.alarm_at_iso,
        recipientLocale,
      ),
    ];
    toPhone = candidate.notify_phone;
  }

  // MOCK mode: log + record as sent so the rest of the flow can be
  // exercised before Meta approves the templates.
  if (isMock || !phoneNumberId) {
    const reason = !phoneNumberId
      ? "WHATSAPP_PHONE_NUMBER_ID not set"
      : "MOCK_WHATSAPP_TEMPLATES=true";
    console.log(
      `[alarm-reminders] MOCK send (${reason}) | template=${templateName} to=${toPhone} body=${JSON.stringify(bodyVariables)}`,
    );
    await admin.from("alarm_notifications_sent").insert({
      ...(candidate.kind === "task"
        ? { task_id: candidate.task_id }
        : { reservation_id: candidate.reservation_id }),
      whatsapp_template: `${templateName} [MOCK]`,
      sent_to_phone: toPhone,
    });
    return { candidate, ok: true, mocked: true };
  }

  try {
    await sendKapsoTemplateWithFallback({
      phoneNumberId,
      to: toPhone,
      templateName,
      preferredLanguage: recipientLocale,
      bodyVariables,
    });
    // Mark as sent ONLY after a successful Kapso ack. If insert fails
    // after a successful send we'd risk double-send — but the unique
    // index on (task_id) / (reservation_id) catches that case the next
    // cron run.
    const { error: trackErr } = await admin
      .from("alarm_notifications_sent")
      .insert({
        ...(candidate.kind === "task"
          ? { task_id: candidate.task_id }
          : { reservation_id: candidate.reservation_id }),
        whatsapp_template: templateName,
        sent_to_phone: toPhone,
      });
    if (trackErr) {
      // Already inserted by an earlier run (unique constraint). Not an
      // error from the caller's perspective.
      console.warn(
        `[alarm-reminders] track insert failed (likely duplicate): ${trackErr.message}`,
      );
    }
    return { candidate, ok: true };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[alarm-reminders] send failed: ${msg}`);
    return { candidate, ok: false, error: msg };
  }
}
