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
 * Antes del swap: si los rooms de esta property tienen sort_order
 * degenerado (todos en 0 o con duplicados), los renumeramos en
 * increments de 10 según el orden visual actual (sort_order ASC,
 * name ASC). Esto cubre el caso típico — el sync de Tuya graba
 * `sort_order = 0` para todos porque la API no manda `sort` confiable.
 */
export async function moveRoom(id: string, direction: "up" | "down") {
  await requireRole(["admin", "gestor"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { error: "ID inválido." };
  }
  const supabase = await createClient();
  const { data: self, error: selfErr } = await supabase
    .from("rooms")
    .select("id, property_id, sort_order, name")
    .eq("id", id)
    .maybeSingle();
  if (selfErr || !self) {
    return { error: selfErr?.message ?? "Ambiente no encontrado." };
  }

  const admin = createAdminClient();

  // Paso 0: normalizar sort_orders de la property si están degenerados.
  // Sin esto, dos rooms con sort_order=0 se "swappean" pero ambos quedan
  // en 0 — el orden visual no cambia.
  const { data: siblings } = await admin
    .from("rooms")
    .select("id, sort_order, name")
    .eq("property_id", self.property_id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const sibs = (siblings ?? []) as Array<{
    id: string;
    sort_order: number;
    name: string;
  }>;
  const orders = sibs.map((s) => s.sort_order);
  const hasDuplicates = new Set(orders).size !== orders.length;
  if (hasDuplicates) {
    // Renumeramos a 10, 20, 30, ... en increments de 10 respetando el
    // orden actual (que ya viene ordenado por sort_order ASC, name ASC).
    // increments de 10 deja espacio para inserts manuales futuros sin
    // tener que renumerar todo.
    for (let i = 0; i < sibs.length; i++) {
      const newOrder = (i + 1) * 10;
      if (sibs[i].sort_order === newOrder) continue;
      const { error } = await admin
        .from("rooms")
        .update({ sort_order: newOrder })
        .eq("id", sibs[i].id);
      if (error) return { error: error.message };
      sibs[i].sort_order = newOrder;
      // Si el room que estamos moviendo es este, refrescar el local.
      if (sibs[i].id === self.id) self.sort_order = newOrder;
    }
  }

  // Buscar el vecino dentro de la misma property.
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

  // Swap en 3 pasos vía service role — sentinel para evitar colisiones
  // si en el futuro agregamos unique(property_id, sort_order).
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
