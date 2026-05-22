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
      /** AUTHENTICATION-only BODY: Meta provee texto fijo, no editable.
       *  Solo configurable es `add_security_recommendation` que agrega
       *  el sufijo "For your security, don't share this code." */
      type: "BODY";
      add_security_recommendation?: boolean;
    }
  | {
      type: "HEADER";
      format: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO";
      text?: string;
    }
  | { type: "FOOTER"; text: string }
  | {
      /** AUTHENTICATION-only FOOTER con expiration timer en lugar de texto. */
      type: "FOOTER";
      code_expiration_minutes: number;
    }
  | {
      type: "BUTTONS";
      buttons: Array<
        | { type: "QUICK_REPLY"; text: string }
        | { type: "URL"; text: string; url: string }
        | { type: "PHONE_NUMBER"; text: string; phone_number: string }
        | {
            /** AUTHENTICATION-only: botón para copiar el código al clipboard. */
            type: "OTP";
            otp_type: "COPY_CODE" | "ONE_TAP";
            text: string;
          }
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
    "Código de acceso a la propiedad. AUTHENTICATION category con formato Meta-prescribed: body fijo provisto por Meta, footer con expiration, botón Copy Code. Variables: 1=código. El contexto (propiedad/fecha) viene por email de Airbnb.",
  components: [
    // Body: Meta provee el texto fijo, no se pasa `text`. La security
    // recommendation suma "Por tu seguridad, no compartas este código."
    { type: "BODY", add_security_recommendation: true },
    // Footer: en lugar de texto custom, AUTHENTICATION acepta una
    // ventana de expiración (minutos). Casa Bosque: 720min = 12h
    // (asume que el huésped lo usa el día del check-in).
    { type: "FOOTER", code_expiration_minutes: 720 },
    // Botón: el huésped tap → copia el código al clipboard.
    {
      type: "BUTTONS",
      buttons: [
        { type: "OTP", otp_type: "COPY_CODE", text: "Copiar código" },
      ],
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
// 6. Recordatorio X horas antes del vencimiento de una tarea (WIK-124).
//    Disparado por el cron `/api/cron/alarm-reminders` cuando el assignee
//    tiene `alarm_hours_before` configurado en la task. Idempotente por
//    `alarm_notifications_sent`.

export const taskReminder: WhatsAppTemplate = {
  name: "task_reminder",
  language: "es",
  category: "UTILITY",
  description:
    "Recordatorio al assignee X horas antes del vencimiento de una tarea. Variables: 1=título, 2=propiedad, 3=cuándo (ej. 'en 2 horas' o 'hoy a las 16:00').",
  components: [
    {
      type: "BODY",
      text: "🔔 Recordatorio de tarea\n\n*{{1}}*\nPropiedad: {{2}}\nVence: {{3}}\n\nVer detalles en admin.example.com/tasks",
      example: {
        body_text: [
          ["Limpieza salida huésped", "Acme Rentals", "en 2 horas"],
        ],
      },
    },
    { type: "FOOTER", text: "Acme Rentals · Tareas" },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// 7. Recordatorio X horas antes del check-in de una reserva (WIK-124).
//    Mismo cron, mismo flujo. Variables específicas a reserva (huésped
//    en lugar de título de tarea).

export const reservationCheckinReminder: WhatsAppTemplate = {
  name: "reservation_checkin_reminder",
  language: "es",
  category: "UTILITY",
  description:
    "Recordatorio al gestor/admin X horas antes del check-in de una reserva. Variables: 1=nombre huésped, 2=propiedad, 3=cuándo (ej. 'en 2 horas' o 'hoy a las 16:00').",
  components: [
    {
      type: "BODY",
      text: "🔔 Próximo check-in\n\nHuésped: *{{1}}*\nPropiedad: {{2}}\nCheck-in: {{3}}\n\nVer detalles en admin.example.com/dashboard",
      example: {
        body_text: [
          ["Juana Pérez", "Acme Rentals", "en 2 horas"],
        ],
      },
    },
    { type: "FOOTER", text: "Acme Rentals · Reservas" },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// 8. Pre-checkin climate conditioning (WIK-125). Cuando hay un check-in
//    en 2h y la temp de la property está fuera del target range, el cron
//    /api/cron/pre-checkin-conditioning manda este template al gestor.
//    Buttons Quick Reply: SI / NO. El bot router maneja el reply y
//    dispara la Tuya scene si es SI.

export const preCheckinClimateAlert: WhatsAppTemplate = {
  name: "pre_checkin_climate_alert",
  language: "es",
  category: "UTILITY",
  description:
    "Alerta 2h antes de un check-in cuando la temp ambiente está fuera del rango target. Buttons Sí/No, el bot dispara la scene Tuya si SI. Variables: 1=property, 2=temp actual con °C, 3=rango target ('20°-25°'), 4='Está frío' o 'Está caliente'.",
  components: [
    {
      type: "BODY",
      text:
        "🌡 *Pre check-in en {{1}}*\n\n" +
        "Temperatura actual: *{{2}}* (target {{3}})\n" +
        "{{4}} para la llegada del huésped en 2 horas.\n\n" +
        "¿Querés que prenda el acondicionamiento?",
      example: {
        body_text: [
          ["Acme Rentals", "14°C", "20°–25°", "Está frío"],
        ],
      },
    },
    { type: "FOOTER", text: "Acme Rentals · Pre check-in" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "Sí, prender" },
        { type: "QUICK_REPLY", text: "No, gracias" },
      ],
    },
  ],
};

// ────────────────────────────────────────────────────────────────────────
// 9. Updates de progreso 1h y 0h antes del check-in (WIK-125). Solo
//    informativo — sin botones — para que el gestor sepa si el ambiente
//    está aclimatando bien.

export const preCheckinClimateUpdate: WhatsAppTemplate = {
  name: "pre_checkin_climate_update",
  language: "es",
  category: "UTILITY",
  description:
    "Update informativo del progreso del acondicionamiento. Sin buttons. Variables: 1=property, 2=temp actual, 3=temp inicial (cuando arrancó el acondicionamiento), 4='falta 1 hora' o 'llegan ahora', 5='Va bien' o 'No está aclimatando como esperado'.",
  components: [
    {
      type: "BODY",
      text:
        "🌡 *{{1}}* — {{4}} para el check-in\n\n" +
        "Temperatura ahora: *{{2}}* (arrancó en {{3}})\n" +
        "{{5}}",
      example: {
        body_text: [
          ["Acme Rentals", "19°C", "14°C", "falta 1 hora", "Va bien"],
        ],
      },
    },
    { type: "FOOTER", text: "Acme Rentals · Pre check-in" },
  ],
};

// ────────────────────────────────────────────────────────────────────────

/**
 * Full registry — useful for iterating in scripts or admin UI.
 *
 * NOTA WIK-78: `guestCheckinCode` queda fuera del registry. Tuvimos
 * 7 intentos de submit:
 *   v1-v5 (UTILITY) → REJECTED · INCORRECT_CATEGORY (classifier ML
 *       de Meta clasifica "código de acceso a huésped" como AUTH)
 *   v6 (MARKETING) → REJECTED · INCORRECT_CATEGORY
 *   v7 (AUTHENTICATION) → 400 · "WABA does not have permission to
 *       create message template" (subcode 2388185)
 *
 * El WABA de Casa Bosque no tiene Authentication products habilitados
 * — requiere upgrade en Meta Business Manager → Security Settings →
 * OTP Configuration. Ver WIK-NN (creado al cerrar WIK-78).
 *
 * Workaround mientras: el código de check-in se manda como mensaje
 * libre cuando el huésped escribe primero (dentro de la ventana 24h),
 * o se le pide que escriba al WA antes del check-in. La info ya está
 * en su email de confirmación de Airbnb de todas formas.
 */
export const allTemplates: WhatsAppTemplate[] = [
  // guestCheckinCode → DESHABILITADO, ver nota arriba.
  guestCheckoutReminder,
  staffTaskAssigned,
  staffSupplyRequestReceived,
  sensorAlarmFired,
  // WIK-124 — recordatorios disparados por cron alarm-reminders.
  taskReminder,
  reservationCheckinReminder,
  // WIK-125 — climate conditioning pre check-in.
  preCheckinClimateAlert,
  preCheckinClimateUpdate,
];
