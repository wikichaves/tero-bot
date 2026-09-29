import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildConsumptionReport } from "@/lib/energy/reports";
import { sendKapsoTemplate, persistMessage, upsertConversation } from "@/lib/whatsapp";
import { APP_HOST } from "@/lib/brand";
import { withCronAlerts } from "@/lib/util/cron-alert";

/**
 * Daily energy report — sent every morning to all admin/gestor profiles
 * with a `whatsapp` number set.
 *
 * Configured in vercel.json (`0 11 * * *` = 8 AM UY/AR / 11 AM UTC).
 *
 * Uses a utility template; verify Meta approval before enabling this version.
 */

type Recipient = {
  id: string;
  full_name: string | null;
  whatsapp: string;
  role: string;
};

export const GET = withCronAlerts("daily-energy-report", async (request: Request) => {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    return NextResponse.json(
      {
        error:
          "WHATSAPP_PHONE_NUMBER_ID env var not set — cannot send messages.",
      },
      { status: 500 },
    );
  }

  const admin = createAdminClient();
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, whatsapp, role")
    .in("role", ["admin", "gestor"])
    .not("whatsapp", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recipients = (profiles ?? []).filter(
    (p): p is Recipient => !!p.whatsapp,
  );

  if (recipients.length === 0) {
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      sent: 0,
      reason:
        "No hay profiles admin/gestor con whatsapp cargado. Cargá tu número en /admin/users → editar.",
    });
  }

  // Build the report once — same content for everyone.
  let reportText: string;
  try {
    reportText = await buildConsumptionReport();
  } catch (e) {
    return NextResponse.json(
      { error: `report build failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  const results = await Promise.all(
    recipients.map(async (r) => {
      try {
        const { id: conversationId } = await upsertConversation({
          phone_number: r.whatsapp,
          display_name: r.full_name ?? null,
        });
        const summary = reportText.replace(/\s+/g, " ").trim();
        const { messageId } = await sendKapsoTemplate({
          phoneNumberId, to: r.whatsapp, templateName: "daily_energy_report_v1", languageCode: "es",
          bodyVariables: [summary.length > 850 ? `${summary.slice(0, 847)}...` : summary,
            `https://${APP_HOST}/energy`],
        });
        await persistMessage({
          conversation_id: conversationId,
          external_id: messageId ?? null,
          direction: "outbound",
          type: "template",
          template_name: "daily_energy_report_v1",
          body: reportText,
          status: "accepted",
        });
        return { profile_id: r.id, ok: true };
      } catch (e) {
        return {
          profile_id: r.id,
          ok: false,
          error: (e as Error).message,
        };
      }
    }),
  );

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  }, { status: results.some((r) => !r.ok) ? 503 : 200 });
});
