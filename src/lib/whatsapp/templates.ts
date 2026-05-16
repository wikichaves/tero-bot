/**
 * WhatsApp template definitions for Meta Business approval.
 *
 * These are NOT submitted automatically — Kapso/Meta requires submitting
 * via the dashboard (or their templates API) and waiting 1-2 days for
 * approval. Once approved, they can be referenced by `name` from
 * `sendKapsoTemplate(name, language, components)`.
 *
 * Format follows Meta's template object schema:
 * https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 *
 * Variables in the body use `{{N}}` placeholders that get filled at send
 * time. Each template includes an `example` block (required by Meta) so
 * the reviewer sees a representative rendered version.
 */

export type WhatsAppTemplateCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION";

export type WhatsAppTemplateComponent =
  | {
      type: "BODY";
      text: string;
      example?: { body_text: string[][] };
    }
  | {
      type: "HEADER";
      format: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO";
      text?: string;
    }
  | { type: "FOOTER"; text: string }
  | {
      type: "BUTTONS";
      buttons: Array<
        | { type: "QUICK_REPLY"; text: string }
        | { type: "URL"; text: string; url: string }
        | { type: "PHONE_NUMBER"; text: string; phone_number: string }
      >;
    };

export type WhatsAppTemplate = {
  name: string;
  language: string;
  category: WhatsAppTemplateCategory;
  components: WhatsAppTemplateComponent[];
  /** Internal docs — not part of Meta's schema. */
  description: string;
};

/**
 * Approval-state tracking for a template, as reported by Meta after we
 * submit it through Kapso. Populated by the status-poll script — the
 * authoritative state lives at Meta and we just cache it here so other
 * parts of the code (UI, send guards) can know which templates are
 * actually usable.
 */
export type WhatsAppTemplateState = {
  /** Meta's template id (returned on creation, also used to fetch status). */
  id: string;
  /** Meta approval state. APPROVED is the only "use it" value. */
  status:
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "PAUSED"
    | "DISABLED";
  /** ISO timestamp of the last status fetch — staleness indicator. */
  checked_at: string;
  /** Meta's reason text when REJECTED, otherwise null. */
  rejected_reason?: string | null;
};

/**
 * Helper to fill template variables at send time.
 * Order of values must match {{1}}, {{2}}, … in the body.
 */
export function templateBodyParameters(values: string[]) {
  return {
    type: "body",
    parameters: values.map((v) => ({ type: "text", text: v })),
  };
}

// ────────────────────────────────────────────────────────────────────────
// 1. Bienvenida / código de check-in para huésped

/**
 * v7 → AUTHENTICATION category (mínima, 1 variable).
 *
 * v1-v5 en UTILITY y v6 en MARKETING: REJECTED INCORRECT_CATEGORY.
 * Meta clasifica "mensaje con código de acceso" → AUTHENTICATION.
 *
 * AUTHENTICATION tiene formato estricto:
 * - Body fijo provisto por Meta (no editable): "{{1}} is your verification code."
 *   (en español: "{{1}} es tu código de verificación")
 * - 1 sola variable (el código)
 * - Body field se omite si usamos `add_security_recommendation=true`
 * - El sender se identifica por el display name del WABA (no hace falta
 *   poner "Acme Rentals" en el body)
 *
 * Trade-off: perdemos el contexto (propiedad, fecha, validez). Esos
 * datos los reciben los huéspedes en su email de confirmación de Airbnb
 * — el WhatsApp es solo para el código en tiempo real. Si después
 * preguntan, se les responde con mensaje libre.
 */
export const guestCheckinCode: WhatsAppTemplate = {
  name: "checkin_otp",
  language: "es",
  category: "AUTHENTICATION",
  description:
    "Código de acceso a la propiedad. AUTHENTICATION category requiere formato Meta-prescribed (1 variable = el código). El contexto (propiedad/fecha) viene por email de Airbnb.",
  components: [
    {
      type: "BODY",
      text: "{{1}} es tu código de acceso a la propiedad.",
      example: {
        body_text: [["8472193"]],
      },
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// 2. Recordatorio de check-out

export const guestCheckoutReminder: WhatsAppTemplate = {
  name: "guest_checkout_reminder",
  language: "es",
  category: "UTILITY",
  description:
    "Recordatorio enviado el día anterior al check-out con horario e instrucciones. Variables: 1=nombre, 2=fecha check-out, 3=hora check-out.",
  components: [
    {
      type: "BODY",
      text: "¡Hola {{1}}! Esperamos que estés disfrutando tu estadía. 🌲\n\nTe recordamos que el check-out es mañana {{2}} a las {{3}}.\n\nAntes de salir, te pedimos:\n✓ Cerrar las ventanas y puertas\n✓ Apagar el aire / calefacción\n✓ Dejar las llaves donde las encontraste\n\n¡Gracias por elegirnos! Cualquier feedback nos ayuda muchísimo.\n\n— Acme Rentals",
      example: {
        body_text: [["Juan", "domingo 17 de mayo", "10:00"]],
      },
    },
    { type: "FOOTER", text: "Acme Rentals" },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// 3. Asignación de tarea a personal interno

export const staffTaskAssigned: WhatsAppTemplate = {
  name: "staff_task_assigned",
  language: "es",
  category: "UTILITY",
  description:
    "Notificación a staff (mantenimiento) cuando admin/gestor le asigna una tarea desde el panel. Variables: 1=título, 2=propiedad, 3=tipo (limpieza/mantenimiento/insumos), 4=cuándo, 5=descripción.",
  components: [
    {
      type: "BODY",
      text: "Nueva tarea asignada:\n\n*{{1}}*\nPropiedad: {{2}}\nTipo: {{3}}\nCuándo: {{4}}\n\nDetalles: {{5}}\n\nConfirmá con un \"OK\" cuando puedas. Cuando termines, escribí \"LISTO\".",
      example: {
        body_text: [
          [
            "Limpieza salida huésped",
            "Acme Rentals",
            "limpieza",
            "viernes 15 a las 11:00",
            "Reposición de toallas, papel higiénico y café.",
          ],
        ],
      },
    },
    { type: "FOOTER", text: "Acme Rentals · Operaciones" },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// 4. Confirmación automática al recibir un reporte de daño/insumo

export const staffSupplyRequestReceived: WhatsAppTemplate = {
  name: "staff_supply_request_received",
  language: "es",
  category: "UTILITY",
  description:
    "Auto-respuesta al staff cuando manda un reporte (insumo faltante, daño, etc.). Confirma recepción y crea la tarea en el panel. Variables: 1=texto del reporte resumido.",
  components: [
    {
      type: "BODY",
      text: "Recibimos tu reporte:\n\n\"{{1}}\"\n\nLo registramos como tarea pendiente. Te avisamos cuando esté resuelto. ¡Gracias!",
      example: {
        body_text: [
          ["Falta papel higiénico en Acme Rentals"],
        ],
      },
    },
    { type: "FOOTER", text: "Acme Rentals · Operaciones" },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// 5. Alarma de sensor T/H (WIK-82). Notif admin/gestor cuando un sensor
//    cruza un threshold. Necesita ser template porque las alarmas pueden
//    dispararse en cualquier momento (fuera de la ventana 24h donde Meta
//    permite mensaje libre).

/**
 * v2 — el body original generaba `Params Words Ratio Exceeds Limit`:
 * Meta exige que el texto fijo sea suficientemente más largo que las
 * variables combinadas. Alargamos el body con contexto operacional
 * que es genuinamente útil para el admin (sugerencia de acción).
 */
export const sensorAlarmFired: WhatsAppTemplate = {
  name: "sensor_alarm_fired",
  language: "es",
  category: "UTILITY",
  description:
    "Notif al admin/gestor cuando un sensor Tuya cruza un umbral configurable (temperatura o humedad). Variables: 1=métrica (Temperatura/Humedad), 2=valor con unidad (ej. 81%), 3=ambiente (ej. Living · Casa Principal), 4=umbral con unidad (ej. > 80%).",
  components: [
    {
      type: "BODY",
      text: "Alerta de sensor en Acme Rentals: la métrica {{1}} en {{3}} cruzó el umbral configurado.\n\nLectura actual: {{2}}\nUmbral establecido: {{4}}\n\nSi corresponde, verificá las condiciones del ambiente (ventilación, temperatura, batería del sensor). Podés ver el histórico completo en admin.example.com/ambientes.",
      example: {
        body_text: [["humedad", "81%", "Living · Casa Principal", "> 80%"]],
      },
    },
    { type: "FOOTER", text: "Acme Rentals · Sensores" },
  ],
};

// ────────────────────────────────────────────────────────────────────────

/** Full registry — useful for iterating in scripts or admin UI. */
export const allTemplates: WhatsAppTemplate[] = [
  guestCheckinCode,
  guestCheckoutReminder,
  staffTaskAssigned,
  staffSupplyRequestReceived,
  sensorAlarmFired,
];
