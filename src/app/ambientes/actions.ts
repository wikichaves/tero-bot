"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";

/**
 * Mover un room arriba o abajo en el orden manual de /ambientes (WIK-98).
 *
 * Implementado como swap con el vecino: agarrar el `sort_order` actual,
 * buscar el row adyacente (next-smaller para "up", next-bigger para
 * "down") dentro de la *misma property*, y swappear los valores. No-op
 * cuando el room ya está en el borde.
 *
 * El swap se hace en 3 pasos vía service role para evitar colisiones
 * intermedias si en el futuro agregamos un unique constraint en
 * (property_id, sort_order).
 */
export async function moveRoom(id: string, direction: "up" | "down") {
  await requireRole(["admin", "gestor"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { error: "ID inválido." };
  }
  const supabase = await createClient();
  const { data: self, error: selfErr } = await supabase
    .from("rooms")
    .select("id, property_id, sort_order")
    .eq("id", id)
    .maybeSingle();
  if (selfErr || !self) {
    return { error: selfErr?.message ?? "Ambiente no encontrado." };
  }

  // Buscar el vecino dentro de la misma property — el orden es por
  // property, no global.
  const neighborQuery =
    direction === "up"
      ? supabase
          .from("rooms")
          .select("id, sort_order")
          .eq("property_id", self.property_id)
          .lt("sort_order", self.sort_order)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle()
      : supabase
          .from("rooms")
          .select("id, sort_order")
          .eq("property_id", self.property_id)
          .gt("sort_order", self.sort_order)
          .order("sort_order", { ascending: true })
          .limit(1)
          .maybeSingle();
  const { data: neighbor } = await neighborQuery;
  if (!neighbor) {
    return { ok: true, noop: true };
  }

  const admin = createAdminClient();
  const SENTINEL = -1_000_000;
  const { error: e1 } = await admin
    .from("rooms")
    .update({ sort_order: SENTINEL })
    .eq("id", self.id);
  if (e1) return { error: e1.message };
  const { error: e2 } = await admin
    .from("rooms")
    .update({ sort_order: self.sort_order })
    .eq("id", neighbor.id);
  if (e2) return { error: e2.message };
  const { error: e3 } = await admin
    .from("rooms")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", self.id);
  if (e3) return { error: e3.message };

  revalidatePath("/ambientes");
  return { ok: true };
}
