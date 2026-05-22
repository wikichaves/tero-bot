import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/whatsapp";
import { triggerScene } from "@/lib/tuya/scenes";

/**
 * Handles incoming WhatsApp replies that look like answers to a
 * pre-checkin alert (WIK-125). Called by the inbound webhook router
 * before generic command parsing.
 *
 * Match strategy:
 *   1. From phone → resolve gestor/admin profile
 *   2. Look for `pre_checkin_conditioning` rows where stage='alert_sent_2h'
 *      and notify_profile = current profile (joined via reservation
 *      property's assigned gestor — same resolution as send-alert)
 *   3. If exactly 1 pending → match it
 *   4. If multiple pending → require disambiguation by short code
 *      ("SI bosque" / "SI julio")
 *   5. Parse intent (sí/no in many forms) and update + (if Sí) trigger scene
 *
 * Returns null if the message doesn't look like a pre-checkin reply at
 * all (caller falls through to other handlers).
 */

export type HandleResponseResult =
  | { handled: false }
  | {
      handled: true;
      outcome: "accepted" | "rejected" | "ambiguous" | "no_pending";
      reply_text: string;
    };

/** Patterns interpreted as "yes" (case-insensitive after trim). */
const YES_PATTERNS = [
  /^s[ií]\b/i,
  /^yes\b/i,
  /^ok\b/i,
  /^dale\b/i,
  /^sí,?\s*prender/i,
  /^si,?\s*prender/i,
];
const NO_PATTERNS = [
  /^no\b/i,
  /^no,?\s*gracias/i,
];

/**
 * Parse intent + optional disambiguation code from a free-form text.
 * Returns { kind: 'yes'|'no', code?: string } when intent is detected.
 *
 * Examples:
 *   "Sí, prender"          → { kind: 'yes' }
 *   "si bosque"            → { kind: 'yes', code: 'bosque' }
 *   "no gracias 14julio"   → { kind: 'no', code: '14julio' }
 *   "qué tal?"             → null
 */
export function parseIntent(
  text: string,
): { kind: "yes" | "no"; code?: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const isYes = YES_PATTERNS.some((p) => p.test(trimmed));
  const isNo = NO_PATTERNS.some((p) => p.test(trimmed));
  if (!isYes && !isNo) return null;
  // Extract first word after the yes/no token as candidate "code"
  const parts = trimmed.split(/\s+/).slice(1);
  // Skip common filler words.
  const FILLER = new Set([
    "gracias",
    "thanks",
    "prender",
    "encender",
    "porfa",
    "por",
    "favor",
    "the",
    ",",
  ]);
  const code = parts.find(
    (w) =>
      w.length >= 3 &&
      !FILLER.has(w.toLowerCase()) &&
      /^[a-z0-9]+$/i.test(w.replace(/[.,]/g, "")),
  );
  return {
    kind: isYes ? "yes" : "no",
    code: code ? code.replace(/[.,]/g, "").toLowerCase() : undefined,
  };
}

/**
 * Same shortCode helper as find-due.ts. Inlined here to avoid an import
 * cycle (handle-response is called from the webhook, find-due from the
 * cron — keeping them decoupled).
 */
function shortCode(name: string): string {
  const noAccents = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const first = noAccents
    .toLowerCase()
    .split(/\s+/)
    .find((w) => w.length >= 3 && !["casa", "the", "los", "las"].includes(w));
  return (first ?? noAccents.toLowerCase().replace(/\s+/g, "")).slice(0, 10);
}

export async function handlePreCheckinResponse(input: {
  fromPhone: string;
  text: string;
}): Promise<HandleResponseResult> {
  const intent = parseIntent(input.text);
  if (!intent) return { handled: false };

  const normalizedPhone = normalizePhone(input.fromPhone);
  if (!normalizedPhone) return { handled: false };

  const admin = createAdminClient();

  // Resolve the profile of the sender to scope pending alerts.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("whatsapp", normalizedPhone)
    .maybeSingle();
  if (!profile) return { handled: false }; // unknown sender, not ours

  // Pull all currently-pending alerts visible to this profile. We scope
  // by property assignment — same as the alert routing logic.
  type PendingRow = {
    id: string;
    reservation_id: string;
    initial_temp_c: number | null;
    reservation: {
      property_id: string;
      property: {
        id: string;
        name: string;
        cool_scene_id: string | null;
        heat_scene_id: string | null;
        target_temp_min_c: number | null;
        target_temp_max_c: number | null;
      } | null;
    };
  };
  // For admins we don't restrict by property assignment. For gestores we
  // restrict to their assigned properties. Mantenimiento role doesn't
  // receive these alerts, so won't have pending rows anyway.
  let allowedPropertyIds: string[] | null = null;
  if ((profile as { role: string }).role === "gestor") {
    const { data: scope } = await admin
      .from("profile_properties")
      .select("property_id")
      .eq("profile_id", (profile as { id: string }).id);
    allowedPropertyIds = ((scope ?? []) as { property_id: string }[]).map(
      (r) => r.property_id,
    );
    if (allowedPropertyIds.length === 0) {
      // gestor without any assignment — can't match anything
      return { handled: true, outcome: "no_pending", reply_text: "No tengo alertas pendientes para vos." };
    }
  }

  let q = admin
    .from("pre_checkin_conditioning")
    .select(
      "id, reservation_id, initial_temp_c, " +
        "reservation:reservations!inner(property_id, " +
        "property:properties(id, name, cool_scene_id, heat_scene_id, target_temp_min_c, target_temp_max_c)" +
        ")",
    )
    .eq("stage", "alert_sent_2h");
  // Order by created_at to make the disambiguation deterministic.
  q = q.order("created_at", { ascending: false });
  const { data: pendingRaw } = await q;
  let pending = ((pendingRaw ?? []) as unknown) as PendingRow[];
  // Filter by property scope in JS (Supabase nested filtering is awkward).
  if (allowedPropertyIds != null) {
    const set = new Set(allowedPropertyIds);
    pending = pending.filter((p) => set.has(p.reservation.property_id));
  }

  if (pending.length === 0) {
    return {
      handled: true,
      outcome: "no_pending",
      reply_text: "No tengo alertas de pre check-in pendientes a tu nombre.",
    };
  }

  // Match a specific row if disambiguation code provided.
  let match: PendingRow | null = null;
  if (intent.code) {
    match =
      pending.find(
        (p) => shortCode(p.reservation.property?.name ?? "") === intent.code,
      ) ?? null;
    if (!match) {
      const codes = pending
        .map((p) => shortCode(p.reservation.property?.name ?? ""))
        .join(", ");
      return {
        handled: true,
        outcome: "ambiguous",
        reply_text: `No reconocí "${intent.code}". Tenés pendientes: ${codes}. Respondé "SI <código>" o "NO <código>".`,
      };
    }
  } else if (pending.length === 1) {
    match = pending[0];
  } else {
    const codes = pending
      .map((p) => shortCode(p.reservation.property?.name ?? ""))
      .join(", ");
    return {
      handled: true,
      outcome: "ambiguous",
      reply_text: `Tenés ${pending.length} alertas pendientes (${codes}). Respondé "SI <código>" o "NO <código>".`,
    };
  }

  // We have a match — apply the decision.
  if (intent.kind === "no") {
    await admin
      .from("pre_checkin_conditioning")
      .update({
        stage: "gestor_responded_no",
        decision: "no_action",
        decision_by: (profile as { id: string }).id,
        decision_at: new Date().toISOString(),
        notes: "gestor respondió NO",
      })
      .eq("id", match.id);
    return {
      handled: true,
      outcome: "rejected",
      reply_text: `Ok, no acondiciono ${match.reservation.property?.name}. ¡Buen check-in!`,
    };
  }

  // YES — trigger the scene
  const property = match.reservation.property;
  if (!property) {
    return {
      handled: true,
      outcome: "rejected",
      reply_text: "Error interno: propiedad no encontrada.",
    };
  }
  // Re-evaluate which direction (cool or heat) was needed. Cheap to
  // re-read current temp; the temp may have shifted slightly but the
  // direction shouldn't have flipped in <2h.
  const targetMin = property.target_temp_min_c;
  const targetMax = property.target_temp_max_c;
  const initial = match.initial_temp_c;
  let sceneId: string | null = null;
  let direction: "cool" | "heat" | null = null;
  if (initial != null && targetMin != null && targetMax != null) {
    if (initial < targetMin && property.heat_scene_id) {
      sceneId = property.heat_scene_id;
      direction = "heat";
    } else if (initial > targetMax && property.cool_scene_id) {
      sceneId = property.cool_scene_id;
      direction = "cool";
    }
  }
  if (!sceneId || !direction) {
    return {
      handled: true,
      outcome: "rejected",
      reply_text:
        "Acepté pero no encuentro la scene Tuya configurada para esta propiedad. Avisame.",
    };
  }

  try {
    await triggerScene(sceneId);
    await admin
      .from("pre_checkin_conditioning")
      .update({
        stage: "started",
        decision: direction,
        decision_by: (profile as { id: string }).id,
        decision_at: new Date().toISOString(),
        scene_triggered_id: sceneId,
        scene_triggered_at: new Date().toISOString(),
        notes: `gestor SI, scene ${direction} disparada`,
      })
      .eq("id", match.id);
    const action = direction === "heat" ? "calefacción" : "aire";
    return {
      handled: true,
      outcome: "accepted",
      reply_text: `🔥 Prendí la ${action} en ${property.name}. Te aviso en 1 hora cómo va.`,
    };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[pre-checkin] scene trigger failed: ${msg}`);
    return {
      handled: true,
      outcome: "rejected",
      reply_text: `Recibí tu OK pero falló el comando a Tuya: ${msg}. Probá manualmente en Smart Life.`,
    };
  }
}
