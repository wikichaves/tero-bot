/**
 * Pure logic for evaluating whether a property needs climate conditioning
 * before a check-in (WIK-125). No DB / no Tuya / no WhatsApp calls — just
 * "given X, decide Y". Easy to test in isolation.
 */

export type ClimateDecision =
  | { kind: "ok"; reason: string }
  | { kind: "needs_cooling"; reason: string }
  | { kind: "needs_heating"; reason: string }
  | { kind: "cannot_evaluate"; reason: string };

/**
 * Decide based on current temperature vs. the property's target range.
 *
 * Inputs are nullable because in real data we hit edge cases:
 * - No sensor in the property → tempC = null
 * - Property not configured with thresholds → either bound = null
 *
 * The function never throws — it returns `cannot_evaluate` with a reason
 * so callers can log + skip without exception handling.
 */
export function evaluateClimate(input: {
  currentTempC: number | null;
  targetMinC: number | null;
  targetMaxC: number | null;
  canCool: boolean;
  canHeat: boolean;
}): ClimateDecision {
  const { currentTempC, targetMinC, targetMaxC, canCool, canHeat } = input;

  if (currentTempC == null) {
    return {
      kind: "cannot_evaluate",
      reason: "no sensor reading available for this property",
    };
  }
  if (targetMinC == null || targetMaxC == null) {
    return {
      kind: "cannot_evaluate",
      reason: "property has no target temperature range configured",
    };
  }
  if (targetMinC >= targetMaxC) {
    return {
      kind: "cannot_evaluate",
      reason: `invalid range: min ${targetMinC} ≥ max ${targetMaxC}`,
    };
  }

  if (currentTempC < targetMinC) {
    if (!canHeat) {
      return {
        kind: "cannot_evaluate",
        reason: `temp ${currentTempC}°C is below ${targetMinC}°C but no heat_scene_id configured`,
      };
    }
    return {
      kind: "needs_heating",
      reason: `temp ${currentTempC}°C is below target ${targetMinC}°C`,
    };
  }
  if (currentTempC > targetMaxC) {
    if (!canCool) {
      return {
        kind: "cannot_evaluate",
        reason: `temp ${currentTempC}°C is above ${targetMaxC}°C but no cool_scene_id configured`,
      };
    }
    return {
      kind: "needs_cooling",
      reason: `temp ${currentTempC}°C is above target ${targetMaxC}°C`,
    };
  }
  return {
    kind: "ok",
    reason: `temp ${currentTempC}°C is within target ${targetMinC}°C–${targetMaxC}°C`,
  };
}

/**
 * Returns true if `now` is inside the "do not send WhatsApp" window
 * (22:00 – 08:00 local UY). We use UTC-3 hardcoded — Montevideo has no
 * DST, so this is stable.
 *
 * Callers that hit a quiet hour mark the row as `quiet_hours_skipped` and
 * the next cron tick (after 08:00) decides whether the check-in is still
 * worth alerting on.
 */
export function isInQuietHours(now: Date): boolean {
  // Compute the local-UY hour without depending on the server's tz.
  // UTC-3 means: localHour = (utcHour - 3 + 24) % 24
  const localHour = (now.getUTCHours() - 3 + 24) % 24;
  return localHour >= 22 || localHour < 8;
}

/**
 * Decide if a check-in is close enough to a given stage's nominal time
 * to fire. Each stage runs in a ±10 min slack window around the target
 * offset from check-in. Matches the cron's 15-min cadence with overlap.
 */
export function isInStageWindow(input: {
  nowMs: number;
  checkInMs: number;
  stageHoursBefore: 2 | 1 | 0;
}): boolean {
  const stageTargetMs =
    input.checkInMs - input.stageHoursBefore * 60 * 60 * 1000;
  const diffMs = Math.abs(input.nowMs - stageTargetMs);
  return diffMs <= 10 * 60 * 1000;
}

/**
 * Convert "needs_cooling" / "needs_heating" to the human-readable string
 * used in the template's `{{4}}` variable.
 */
export function decisionToBodyHint(
  decision: ClimateDecision,
): string {
  if (decision.kind === "needs_cooling") return "Está caliente";
  if (decision.kind === "needs_heating") return "Está frío";
  return ""; // for ok / cannot_evaluate we don't send an alert
}
