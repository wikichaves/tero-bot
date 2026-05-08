import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile, Property, Task } from "@/lib/types";

/**
 * Create a task from a WhatsApp message — either an explicit `tarea ...`
 * command or a photo upload. The caller already verified the sender's phone
 * matches a known profile.
 *
 * Decisions:
 *  - **Property**: try to match a property name (or word in it) inside the
 *    text. If only one property exists in the system, default to that. If
 *    none match and there are multiple, return a help message asking the
 *    user to retry with the property name.
 *  - **Kind**: keyword-detect from the text. Default `mantenimiento` if a
 *    photo is attached (photos usually report something broken), else `otro`.
 *  - **Title** / **Description**: first line is title (≤120 chars), rest is
 *    description. If a photo was attached, the URL is appended to description
 *    as `📸 Foto: <url>` (no schema change required for media storage).
 *  - **Assignee**: staff (limpieza/mantenimiento) auto-assign to themselves;
 *    admin/gestor leave unassigned for triage.
 */

export type CreateTaskFromWAResult =
  | { ok: true; taskId: string; reply: string }
  | { ok: false; reply: string };

export type CreateTaskFromWAInput = {
  /** Caller-supplied profile (already authenticated by phone). */
  profile: Profile;
  /** Free-form text or caption. May be null for a no-caption photo. */
  text: string | null;
  /** WhatsApp media URL if a photo/audio/video was attached. */
  mediaUrl?: string | null;
  /**
   * Optional pre-fetched properties — if the caller already has them in
   * hand (e.g. fetched in parallel with the profile lookup), pass them to
   * skip the DB roundtrip.
   */
  prefetchedProperties?: Pick<Property, "id" | "name">[];
};

const KIND_PATTERNS: Array<{ kind: Task["kind"]; rx: RegExp }> = [
  { kind: "limpieza", rx: /\b(limpi[ae][rz]?|aspirar|lavar|barrer|trapear)\b/i },
  {
    kind: "mantenimiento",
    rx: /\b(mantenimiento|mantener|arreglar|reparar|rota|roto|romp[ie]ron?|fuga|gotea|no\s+func|cambia[rs]|fall[ao])\b/i,
  },
  {
    kind: "insumos",
    rx: /\b(insumos?|comprar|falta|hay\s+que\s+comprar|reposici[oó]n|stock)\b/i,
  },
];

/**
 * Strip the leading command keyword from a `tarea ...` / `nueva tarea ...` /
 * `reportar ...` message. Returns the remainder, or the original if no
 * keyword was found.
 */
export function stripCreateKeyword(text: string): string {
  return text.replace(/^(nueva\s+tarea|tarea|reportar|report)\b[:\s]*/i, "").trim();
}

/**
 * Returns true if the text begins with a `tarea` / `nueva tarea` / `reportar`
 * keyword — used to route inbound text into the create-task flow.
 */
export function looksLikeCreateTaskCommand(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  return /^(nueva\s+tarea|tarea|reportar|report)\b/i.test(text.trim());
}

function detectKind(text: string, hasPhoto: boolean): Task["kind"] {
  for (const { kind, rx } of KIND_PATTERNS) {
    if (rx.test(text)) return kind;
  }
  return hasPhoto ? "mantenimiento" : "otro";
}

function detectProperty(
  text: string,
  properties: Pick<Property, "id" | "name">[],
): Pick<Property, "id" | "name"> | null {
  if (properties.length === 1) return properties[0];
  if (!text) return null;
  const lower = text.toLowerCase();
  // Pass 1: exact substring match on full property name.
  for (const p of properties) {
    if (lower.includes(p.name.toLowerCase())) return p;
  }
  // Pass 2: any word ≥4 chars from the property name appears in the text.
  for (const p of properties) {
    const words = p.name
      .toLowerCase()
      .split(/[\s,.\-]+/)
      .filter((w) => w.length >= 4);
    if (words.some((w) => lower.includes(w))) return p;
  }
  return null;
}

const MAX_TITLE_LEN = 120;

function splitTitleDescription(text: string): {
  title: string;
  description: string | null;
} {
  const cleaned = text.trim();
  if (!cleaned) {
    return { title: "Reporte WhatsApp", description: null };
  }
  // First line as title; rest as description. If first line is too long, cut.
  const lines = cleaned.split(/\r?\n/);
  let title = lines[0].trim();
  let description = lines.slice(1).join("\n").trim();
  if (title.length > MAX_TITLE_LEN) {
    description = (title.slice(MAX_TITLE_LEN).trim() +
      (description ? "\n" + description : "")).trim();
    title = title.slice(0, MAX_TITLE_LEN).trim();
  }
  return { title, description: description || null };
}

export async function createTaskFromWhatsApp(
  input: CreateTaskFromWAInput,
): Promise<CreateTaskFromWAResult> {
  const { profile, mediaUrl } = input;
  const hasPhoto = !!mediaUrl;
  const cleanText = stripCreateKeyword(input.text ?? "");

  // Guard: command without any content (e.g. just "tarea") and no photo.
  // Ask the user to retry with a description so we don't end up with empty
  // "Reporte WhatsApp" tasks.
  if (!cleanText && !hasPhoto) {
    return {
      ok: false,
      reply:
        `📝 Necesito una descripción o una foto para crear la tarea.\n\n` +
        `Probá:\n• \`tarea <propiedad> se rompió la canilla\`\n` +
        `• o mandá una foto del problema (con caption opcional)`,
    };
  }

  const admin = createAdminClient();
  let properties: Pick<Property, "id" | "name">[];
  if (input.prefetchedProperties) {
    properties = input.prefetchedProperties;
  } else {
    const { data: propertyRows, error: propsErr } = await admin
      .from("properties")
      .select("id, name")
      .order("name");
    if (propsErr) {
      return {
        ok: false,
        reply: `❌ No pude buscar propiedades: ${propsErr.message}`,
      };
    }
    properties = (propertyRows ?? []) as Pick<Property, "id" | "name">[];
  }
  if (properties.length === 0) {
    return {
      ok: false,
      reply:
        "❌ No hay propiedades cargadas todavía. Pedile a un admin que las cree.",
    };
  }

  const property = detectProperty(cleanText, properties);
  if (!property) {
    const list = properties.map((p) => `• ${p.name}`).join("\n");
    return {
      ok: false,
      reply:
        `🤔 No supe a qué propiedad referís. Reintentá incluyendo el nombre, ej:\n\n` +
        `_tarea ${properties[0]?.name.split(" ").pop()?.toLowerCase()} se rompió la canilla_\n\n` +
        `Propiedades:\n${list}`,
    };
  }

  const kind = detectKind(cleanText, hasPhoto);
  const { title: rawTitle, description: rawDescription } =
    splitTitleDescription(cleanText);

  // For a no-caption photo, use a friendlier default title.
  const title =
    !cleanText && hasPhoto
      ? `Reporte con foto · ${property.name}`
      : rawTitle;

  const photoLine = mediaUrl ? `📸 Foto: ${mediaUrl}` : "";
  const reportedBy = `🟢 Reportado por WhatsApp por ${profile.full_name ?? profile.email}`;
  const description = [rawDescription, photoLine, reportedBy]
    .filter(Boolean)
    .join("\n\n");

  // Staff auto-assign to themselves; admin/gestor leave unassigned for triage.
  const isStaff =
    profile.role === "limpieza" || profile.role === "mantenimiento";
  const assigned_to = isStaff ? profile.id : null;

  const { data: inserted, error } = await admin
    .from("tasks")
    .insert({
      property_id: property.id,
      kind,
      title,
      description,
      assigned_to,
      reported_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return {
      ok: false,
      reply: `❌ No pude crear la tarea: ${error?.message ?? "error desconocido"}`,
    };
  }

  const KIND_LABEL: Record<Task["kind"], string> = {
    limpieza: "🧹 Limpieza",
    mantenimiento: "🔧 Mantenimiento",
    insumos: "📦 Insumos",
    otro: "📋 Tarea",
  };
  const assignedLine = isStaff
    ? `\n👤 Asignada a vos.`
    : `\n👤 Sin asignar — algún admin/gestor te la deriva.`;
  const link = isStaff
    ? "admin.example.com/mis-tareas"
    : `admin.example.com/tasks/${inserted.id}`;
  const reply =
    `✅ *Tarea creada*\n\n` +
    `*${title}*\n` +
    `${KIND_LABEL[kind]} · 🏠 ${property.name}` +
    assignedLine +
    `\n\n_Verla en: ${link}_`;

  return { ok: true, taskId: inserted.id, reply };
}
