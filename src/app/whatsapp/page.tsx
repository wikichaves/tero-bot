import Link from "next/link";
import { formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WhatsAppConversation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WhatsAppInboxPage() {
  await requireRole(["admin"]);
  const t = await getTranslations("whatsappInbox");
  const AUDIENCE_LABEL: Record<WhatsAppConversation["audience"], string> = {
    guest: t("audience.guest"),
    staff: t("audience.staff"),
    unknown: t("audience.unknown"),
  };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select(
      "id, phone_number, display_name, audience, profile_id, last_message_at, last_message_text, last_message_direction, unread_count, created_at, updated_at",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);
  const conversations = (data ?? []) as WhatsAppConversation[];

  // WIK-327: badge "no entregado" en el inbox. La tabla whatsapp_conversations
  // no guarda el status del último mensaje, así que traemos —en UNA query
  // batcheada— los mensajes outbound con status=failed de estas conversaciones
  // y marcamos como "con fallo" a las que su ÚLTIMO outbound falló. Solo
  // aplica a conversaciones cuyo último mensaje fue outbound (si el último es
  // inbound, un fallo viejo ya no es relevante para el estado actual).
  const failedByConversation = new Set<string>();
  const convIds = conversations
    .filter((c) => c.last_message_direction === "outbound")
    .map((c) => c.id);
  if (convIds.length > 0) {
    const { data: failedMsgs } = await supabase
      .from("whatsapp_messages")
      .select("conversation_id, status, sent_at")
      .in("conversation_id", convIds)
      .eq("direction", "outbound")
      .order("sent_at", { ascending: false });
    // Nos quedamos con el ÚLTIMO outbound por conversación; si ese está
    // failed, la marcamos. (La lista viene ordenada desc por sent_at.)
    const seen = new Set<string>();
    for (const m of (failedMsgs ?? []) as Array<{
      conversation_id: string;
      status: string | null;
    }>) {
      if (seen.has(m.conversation_id)) continue;
      seen.add(m.conversation_id);
      if (m.status === "failed") failedByConversation.add(m.conversation_id);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          {t("conversationCount", { count: conversations.length })}
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            {error.message}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {conversations.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t("emptyState")}
            </p>
          ) : (
            <ul className="divide-y">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/whatsapp/${c.id}`}
                    className="flex items-center gap-4 p-4 hover:bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {c.display_name ?? c.phone_number}
                        </span>
                        <Badge variant="secondary" className="shrink-0">
                          {AUDIENCE_LABEL[c.audience]}
                        </Badge>
                        {c.unread_count > 0 && (
                          <Badge className="shrink-0">
                            {c.unread_count}
                          </Badge>
                        )}
                        {failedByConversation.has(c.id) && (
                          <Badge
                            variant="destructive"
                            className="shrink-0"
                          >
                            {t("notDelivered")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {c.last_message_direction === "outbound" &&
                          t("outboundPrefix")}
                        {c.last_message_text ?? t("noMessages")}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {c.last_message_at &&
                        formatDistanceToNow(parseISO(c.last_message_at), {
                          addSuffix: true,
                          locale: es,
                        })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
