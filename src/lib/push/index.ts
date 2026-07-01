import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/whatsapp";

/**
 * Web Push (WIK-311) — transport para mandar notificaciones push a la PWA
 * instalada del operador. Opt-in: el usuario habilita las push desde "Mi
 * perfil"; cada navegador/dispositivo guarda una fila en
 * `push_subscriptions`.
 *
 * Este módulo es agnóstico del evento — lo consumen los notificadores de
 * dominio (sensors/notify, pre-checkin) en el layer de orquestación, igual
 * que el transport de WhatsApp. Best-effort: nunca tira; si VAPID no está
 * configurado, no hace nada (no rompe el flujo de WhatsApp que sí funciona).
 *
 * Las claves VAPID se generan una vez con `npx web-push generate-vapid-keys`
 * y van a las env vars (ver `.env.example`):
 *   - NEXT_PUBLIC_VAPID_PUBLIC_KEY  (pública, también la usa el cliente)
 *   - VAPID_PRIVATE_KEY             (privada, server-only)
 *   - VAPID_SUBJECT                 (mailto: o https: de contacto)
 */

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:wikichaves@gmail.com";
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  /** URL a abrir al tocar la notificación. Default `/dashboard`. */
  url?: string;
  /** Tag para colapsar notificaciones del mismo tipo en el SO. */
  tag?: string;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Entrega un payload a una lista de suscripciones. Poda (borra) las que el
 * push service reporta como muertas (404/410). Devuelve cuántas se
 * entregaron OK. Best-effort: cualquier otro error se loguea y se sigue.
 */
async function deliver(
  subs: SubscriptionRow[],
  payload: PushPayload,
  admin: ReturnType<typeof createAdminClient>,
): Promise<number> {
  if (subs.length === 0) return 0;
  const body = JSON.stringify(payload);
  const deadIds: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Suscripción expirada / cancelada → la podamos.
          deadIds.push(sub.id);
        } else {
          console.warn(
            `[push] send failed endpoint=${sub.endpoint.slice(0, 40)}… ${
              (err as Error).message
            }`,
          );
        }
      }
    }),
  );

  if (deadIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", deadIds);
    console.log(`[push] pruned ${deadIds.length} dead subscriptions`);
  }

  return sent;
}

/**
 * Manda una push a todas las suscripciones de los profiles indicados.
 * Devuelve cuántas notificaciones se entregaron OK.
 */
export async function sendPushToProfiles(
  profileIds: string[],
  payload: PushPayload,
): Promise<number> {
  if (!ensureConfigured()) {
    console.log("[push] VAPID no configurado, skip");
    return 0;
  }
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  if (ids.length === 0) return 0;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("profile_id", ids);
  if (error) {
    console.warn(`[push] subscription lookup failed: ${error.message}`);
    return 0;
  }
  return await deliver((data ?? []) as SubscriptionRow[], payload, admin);
}

/**
 * Manda una push a los dueños (profiles) de los teléfonos indicados.
 * Resuelve phone → profile vía `profiles.whatsapp` (normalizado) y delega
 * en `sendPushToProfiles`. Útil para flujos que sólo conocen el teléfono
 * del destinatario (ej. pre-checkin).
 */
export async function sendPushToPhones(
  phones: (string | null | undefined)[],
  payload: PushPayload,
): Promise<number> {
  if (!ensureConfigured()) return 0;
  const normalized = Array.from(
    new Set(
      phones
        .map((p) => normalizePhone(p ?? undefined))
        .filter((p): p is string => !!p),
    ),
  );
  if (normalized.length === 0) return 0;
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .in("whatsapp", normalized);
  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length === 0) return 0;
  return await sendPushToProfiles(ids, payload);
}
