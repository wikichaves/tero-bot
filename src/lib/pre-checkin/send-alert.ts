import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendKapsoTemplate } from "@/lib/whatsapp";
import { getCurrentTempForProperty } from "./current-temp";
import {
  evaluateClimate,
  isInQuietHours,
  decisionToBodyHint,
} from "./evaluate";
import type { PreCheckinCandidate } from "./find-due";

/**
 * Evaluate a candidate at the 2h-before stage and, if action is needed,
 * send the Sí/No alert (WIK-125).
 *
 * Side effects:
 *   - Always inserts a `pre_checkin_conditioning` row (idempotency via
 *     unique index on reservation_id — duplicate inserts fail silently
 *     because findDueAt2h pre-filters).
 *   - Stage of the inserted row reflects what happened:
 *       no_action_needed     temp in range, no alert sent
 *       alert_sent_2h        alert sent successfully, awaiting reply
 *       quiet_hours_skipped  inside 22-08 UY window, will re-evaluate next tick
 *       cannot_evaluate      no sensor / missing config / etc. — admin should fix
 *
 * MOCK_WHATSAPP_TEMPLATES=true → no send, just logs + still tracks.
 */
export type SendAlertResult = {
  reservation_id: string;
  outcome:
    | "alert_sent"
    | "no_action_needed"
    | "quiet_hours_skipped"
    | "cannot_evaluate"
    | "send_failed";
  reason: string;
  current_temp_c: number | null;
  template_mock?: boolean;
};

export async function sendPreCheckinAlert(
  candidate: PreCheckinCandidate,
  nowMs: number,
): Promise<SendAlertResult> {
  const admin = createAdminClient();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const isMock = process.env.MOCK_WHATSAPP_TEMPLATES === "true";

  // 1. Read current temp
  const reading = await getCurrentTempForProperty(candidate.property_id);

  // 2. Decide
  const decision = evaluateClimate({
    currentTempC: reading.temp_c,
    targetMinC: candidate.target_min_c,
    targetMaxC: candidate.target_max_c,
    canCool: !!candidate.cool_scene_id,
    canHeat: !!candidate.heat_scene_id,
  });

  // 3. If no action needed → log + insert "done" row, return
  if (decision.kind === "ok") {
    await admin.from("pre_checkin_conditioning").insert({
      reservation_id: candidate.reservation_id,
      stage: "no_action_needed",
      decision: "no_action",
      initial_temp_c: reading.temp_c,
      notes: decision.reason,
    });
    return {
      reservation_id: candidate.reservation_id,
      outcome: "no_action_needed",
      reason: decision.reason,
      current_temp_c: reading.temp_c,
    };
  }

  // 4. If we can't evaluate (no sensor / no thresholds) → insert + log
  if (decision.kind === "cannot_evaluate") {
    await admin.from("pre_checkin_conditioning").insert({
      reservation_id: candidate.reservation_id,
      stage: "no_action_needed",
      decision: "no_action",
      initial_temp_c: reading.temp_c,
      notes: `cannot_evaluate: ${decision.reason}`,
    });
    return {
      reservation_id: candidate.reservation_id,
      outcome: "cannot_evaluate",
      reason: decision.reason,
      current_temp_c: reading.temp_c,
    };
  }

  // 5. If quiet hours → mark + skip. Next tick re-evaluates (the
  //    "first time entry" gate is the absence of any tracking row, so
  //    inserting this row stops re-entry). We mark stage='quiet_hours_skipped'
  //    so the user can see it in the dashboard.
  //
  //    Edge case: if next non-quiet tick is past the check-in, this row
  //    just stays as "skipped". That's fine — the user can act manually.
  if (isInQuietHours(new Date(nowMs))) {
    await admin.from("pre_checkin_conditioning").insert({
      reservation_id: candidate.reservation_id,
      stage: "quiet_hours_skipped",
      decision: null,
      initial_temp_c: reading.temp_c,
      notes: `would have alerted "${decision.kind}" but quiet hours (22-08 UY)`,
    });
    return {
      reservation_id: candidate.reservation_id,
      outcome: "quiet_hours_skipped",
      reason: "quiet hours",
      current_temp_c: reading.temp_c,
    };
  }

  // 6. Send the alert
  const tempStr = `${reading.temp_c}°C`;
  const targetStr = `${candidate.target_min_c}°–${candidate.target_max_c}°`;
  const bodyHint = decisionToBodyHint(decision);
  // Multi-pending disambiguation: prepend the short code to property name
  // so the gestor can tell which one a "Sí, prender" refers to. Cheap:
  // adds it always (the template doesn't show the short code explicitly,
  // it's part of the property var).
  const propertyLabel = `${candidate.property_name} (${candidate.property_short_code})`;
  const bodyVariables = [propertyLabel, tempStr, targetStr, bodyHint];

  if (isMock || !phoneNumberId) {
    const why = !phoneNumberId
      ? "WHATSAPP_PHONE_NUMBER_ID not set"
      : "MOCK_WHATSAPP_TEMPLATES=true";
    console.log(
      `[pre-checkin] MOCK alert (${why}) | to=${candidate.notify_phone} body=${JSON.stringify(bodyVariables)}`,
    );
    await admin.from("pre_checkin_conditioning").insert({
      reservation_id: candidate.reservation_id,
      stage: "alert_sent_2h",
      decision: null,
      initial_temp_c: reading.temp_c,
      notes: `MOCK alert sent (${decision.kind})`,
    });
    return {
      reservation_id: candidate.reservation_id,
      outcome: "alert_sent",
      reason: decision.reason,
      current_temp_c: reading.temp_c,
      template_mock: true,
    };
  }

  try {
    await sendKapsoTemplate({
      phoneNumberId,
      to: candidate.notify_phone,
      templateName: "pre_checkin_climate_alert",
      languageCode: "es",
      bodyVariables,
    });
    await admin.from("pre_checkin_conditioning").insert({
      reservation_id: candidate.reservation_id,
      stage: "alert_sent_2h",
      decision: null,
      initial_temp_c: reading.temp_c,
      notes: `alert sent (${decision.kind})`,
    });
    return {
      reservation_id: candidate.reservation_id,
      outcome: "alert_sent",
      reason: decision.reason,
      current_temp_c: reading.temp_c,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[pre-checkin] send failed: ${msg}`);
    // Do NOT insert tracking row — next cron run will retry the send.
    return {
      reservation_id: candidate.reservation_id,
      outcome: "send_failed",
      reason: msg,
      current_temp_c: reading.temp_c,
    };
  }
}

/**
 * Progress update at T-1h or T-0h for reservations that have a
 * 'started' / 'check_1h_done' tracking row (WIK-125).
 *
 * Sends the `pre_checkin_climate_update` template, transitions the row
 * to the next stage, and logs.
 *
 * No alert is sent in mock mode — only stage transitions + console log.
 */
export type SendUpdateResult = {
  reservation_id: string;
  outcome: "update_sent" | "update_skipped_quiet" | "send_failed";
  current_temp_c: number | null;
  delta_c: number | null;
};

export async function sendPreCheckinUpdate(
  candidate: PreCheckinCandidate,
  nowMs: number,
  stageBefore: "started" | "check_1h_done",
): Promise<SendUpdateResult> {
  const admin = createAdminClient();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const isMock = process.env.MOCK_WHATSAPP_TEMPLATES === "true";

  const nextStage = stageBefore === "started" ? "check_1h_done" : "check_0h_done";
  // WIK-125 v2: el template aprobado tiene 4 vars (no 5). Mantenemos
  // el texto natural en español para el campo "tiempo hasta check-in".
  const remainingLabel = stageBefore === "started" ? "1 hora" : "menos de 30 minutos";

  const reading = await getCurrentTempForProperty(candidate.property_id);
  const initial = candidate.initial_temp_c;
  const deltaC =
    initial != null && reading.temp_c != null
      ? Math.round((reading.temp_c - initial) * 10) / 10
      : null;

  // "Va bien" if delta is in the right direction (warming when we needed
  // heat, cooling when we needed cool) AND we're already inside the range
  // OR moving toward it. Compose the "status with context" string used
  // as variable {{3}} in the template (combines what was previously
  // 2 separate variables for status + initial-temp).
  const targetMin = candidate.target_min_c;
  const targetMax = candidate.target_max_c;
  let progressLabel = "sin datos suficientes para evaluar";
  if (reading.temp_c != null && targetMin != null && targetMax != null) {
    const inRange = reading.temp_c >= targetMin && reading.temp_c <= targetMax;
    if (inRange) {
      progressLabel = `✓ ambiente en rango target${initial != null ? `, inició en ${initial}°C` : ""}`;
    } else if (deltaC != null && initial != null) {
      const wasBelow = initial < targetMin;
      const wasAbove = initial > targetMax;
      if (wasBelow && deltaC > 0.5)
        progressLabel = `Va bien (subiendo, inició en ${initial}°C)`;
      else if (wasAbove && deltaC < -0.5)
        progressLabel = `Va bien (bajando, inició en ${initial}°C)`;
      else
        progressLabel = `No está aclimatando como esperado (inició en ${initial}°C)`;
    }
  }

  if (isInQuietHours(new Date(nowMs))) {
    // Skip silent — transition stage so we don't re-evaluate.
    if (candidate.existing_id) {
      await admin
        .from("pre_checkin_conditioning")
        .update({ stage: nextStage, notes: "skipped update (quiet hours)" })
        .eq("id", candidate.existing_id);
    }
    return {
      reservation_id: candidate.reservation_id,
      outcome: "update_skipped_quiet",
      current_temp_c: reading.temp_c,
      delta_c: deltaC,
    };
  }

  // 4 variables (v2 template). The initial-temp context is now folded
  // into `progressLabel` rather than being a separate var.
  const bodyVariables = [
    candidate.property_name,
    `${reading.temp_c ?? "?"}°C`,
    progressLabel,
    remainingLabel,
  ];

  if (isMock || !phoneNumberId) {
    console.log(
      `[pre-checkin] MOCK update | to=${candidate.notify_phone} body=${JSON.stringify(bodyVariables)}`,
    );
    if (candidate.existing_id) {
      await admin
        .from("pre_checkin_conditioning")
        .update({ stage: nextStage, notes: `MOCK update sent` })
        .eq("id", candidate.existing_id);
    }
    return {
      reservation_id: candidate.reservation_id,
      outcome: "update_sent",
      current_temp_c: reading.temp_c,
      delta_c: deltaC,
    };
  }

  try {
    await sendKapsoTemplate({
      phoneNumberId,
      to: candidate.notify_phone,
      templateName: "pre_checkin_climate_update",
      languageCode: "es",
      bodyVariables,
    });
    if (candidate.existing_id) {
      await admin
        .from("pre_checkin_conditioning")
        .update({ stage: nextStage, notes: `update sent (${progressLabel})` })
        .eq("id", candidate.existing_id);
    }
    return {
      reservation_id: candidate.reservation_id,
      outcome: "update_sent",
      current_temp_c: reading.temp_c,
      delta_c: deltaC,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[pre-checkin] update send failed: ${msg}`);
    return {
      reservation_id: candidate.reservation_id,
      outcome: "send_failed",
      current_temp_c: reading.temp_c,
      delta_c: deltaC,
    };
  }
}
