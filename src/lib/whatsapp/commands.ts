import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildConsumptionReport } from "@/lib/energy/reports";
import { normalizePhone } from "./index";

export type ParsedCommand =
  | { type: "consumption"; propertyFilter: string | null }
  | { type: "help" }
  | null;

const HELP_TEXT = `🌲 *Acme Rentals · Comandos*

📊 *Consumo*
• \`consumo\` — resumen total (hoy + 7 días)
• \`consumo merced\` — solo Acme Rentals
• \`consumo 14 julio\` — solo Casa Secundaria

❓ *Ayuda*
• \`ayuda\` — esta lista

_Sandbox de Kapso. Más comandos próximamente._`;

/**
 * Parse a free-form WhatsApp text into a command. Returns null if it doesn't
 * look like a command — caller should fall through to default behavior.
 */
export function parseCommand(text: string | null | undefined): ParsedCommand {
  if (!text) return null;
  const lower = text.trim().toLowerCase();

  if (/^(ayuda|help|comandos|menu)\b/.test(lower)) {
    return { type: "help" };
  }

  // "consumo" or "consumo <name>" — match consumption query
  if (/^(consumo|energ[ií]a|electricidad|cu[aá]nto|kwh)\b/.test(lower)) {
    // Extract property filter (everything after the first keyword)
    const m = lower.match(/^[^\s]+\s+(.+)$/);
    const filter = m ? m[1].trim() : null;
    return { type: "consumption", propertyFilter: filter };
  }

  return null;
}

/**
 * Check whether a phone number belongs to a profile that's authorized to
 * issue commands (admin or gestor).
 */
export async function isAuthorizedCommandSender(
  phoneNumber: string,
): Promise<boolean> {
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) return false;
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("whatsapp", normalized)
    .maybeSingle();
  if (!data) return false;
  return data.role === "admin" || data.role === "gestor";
}

/**
 * Run a parsed command and return the response text. Returns null if the
 * input wasn't a command at all. If it was a command but the sender isn't
 * authorized, returns an explanatory message (helpful for sandbox debugging
 * — easy to lock this down later by returning null).
 */
export async function runCommand(
  command: ParsedCommand,
  fromPhone: string,
): Promise<string | null> {
  if (!command) return null;
  const allowed = await isAuthorizedCommandSender(fromPhone);
  if (!allowed) {
    const normalized = normalizePhone(fromPhone) ?? fromPhone;
    return `🔒 Tu número (\`${normalized}\`) no está autorizado para usar comandos.\n\nSi sos admin/gestor de Acme Rentals, cargá ese número exacto en tu profile (admin.example.com → Usuarios → editar) y reintentá.`;
  }

  switch (command.type) {
    case "help":
      return HELP_TEXT;
    case "consumption":
      try {
        return await buildConsumptionReport({
          propertyFilter: command.propertyFilter,
        });
      } catch (e) {
        return `❌ No pude generar el reporte: ${(e as Error).message}`;
      }
  }
}
