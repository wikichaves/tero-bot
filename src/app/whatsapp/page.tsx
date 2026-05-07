import Link from "next/link";
import { formatDistanceToNow, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WhatsAppConversation } from "@/lib/types";

export const dynamic = "force-dynamic";

const AUDIENCE_LABEL: Record<WhatsAppConversation["audience"], string> = {
  guest: "Huésped",
  staff: "Staff",
  unknown: "—",
};

export default async function WhatsAppInboxPage() {
  await requireRole(["admin", "gestor"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);
  const conversations = (data ?? []) as WhatsAppConversation[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          {conversations.length} conversación
          {conversations.length === 1 ? "" : "es"}.
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
              Sin conversaciones. Cuando alguien escriba al número de WhatsApp,
              va a aparecer acá.
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
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {c.last_message_direction === "outbound" && "Tú: "}
                        {c.last_message_text ?? "(sin mensajes)"}
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
