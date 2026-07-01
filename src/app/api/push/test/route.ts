import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPushToProfiles } from "@/lib/push";

/**
 * Manda una push de prueba al propio usuario logueado (WIK-311). Lo usa el
 * botón "Probar" de "Mi perfil" para confirmar que la suscripción quedó
 * bien y que el SO muestra la notificación.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sent = await sendPushToProfiles([user.id], {
    title: "tero.bot",
    body: "Notificación de prueba ✅ — las push están activas.",
    url: "/dashboard",
    tag: "test",
  });

  if (sent === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No se entregó ninguna push. Revisá que las notificaciones estén habilitadas y que VAPID esté configurado.",
      },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: true, sent });
}
