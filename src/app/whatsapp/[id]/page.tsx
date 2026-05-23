import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReplyForm } from "./reply-form";
import { markRead } from "./actions";
import type {
  WhatsAppConversation,
  WhatsAppMessage,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const AUDIENCE_LABEL: Record<WhatsAppConversation["audience"], string> = {
  guest: "Huésped",
  staff: "Staff",
  unknown: "—",
};

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: convo }, { data: messages }] = await Promise.all([
    supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("conversation_id", id)
      .order("sent_at", { ascending: true })
      .limit(500),
  ]);

  if (!convo) notFound();
  const conversation = convo as WhatsAppConversation;
  const list = (messages ?? []) as WhatsAppMessage[];

  // Fire-and-forget mark-as-read on every render of the detail page.
  if (conversation.unread_count > 0) {
    void markRead(conversation.id);
  }

  // 24h window check: when did the user last send us a message?
  // This is a server component, rendered once per request — Date.now() is
  // fine here even though the linter flags it as impure (the warning is
  // about client re-renders, which don't apply).
  const lastInbound = [...list]
    .reverse()
    .find((m) => m.direction === "inbound");
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const within24h =
    !!lastInbound &&
    nowMs - parseISO(lastInbound.sent_at).getTime() < 24 * 60 * 60 * 1000;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/whatsapp"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Volver
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg truncate">
                {conversation.display_name ?? conversation.phone_number}
              </h1>
              <Badge variant="secondary">
                {AUDIENCE_LABEL[conversation.audience]}
              </Badge>
            </div>
            {conversation.display_name && (
              <p className="text-sm text-muted-foreground font-mono">
                {conversation.phone_number}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-muted/30">
        {list.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            Sin mensajes en esta conversación todavía.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 max-w-2xl mx-auto">
            {list.map((m) => (
              <li
                key={m.id}
                className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                    m.direction === "outbound"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-card border rounded-bl-sm"
                  }`}
                >
                  {m.body && <p className="text-sm whitespace-pre-wrap">{m.body}</p>}
                  {m.media_url && (
                    <a
                      href={m.media_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline opacity-80"
                    >
                      Ver {m.type}
                    </a>
                  )}
                  {m.template_name && (
                    <p className="text-xs opacity-70 mt-1">
                      template: {m.template_name}
                    </p>
                  )}
                  <p
                    className={`text-[10px] mt-1 ${m.direction === "outbound" ? "opacity-70" : "text-muted-foreground"}`}
                  >
                    {format(parseISO(m.sent_at), "HH:mm", { locale: es })}
                    {m.status && ` · ${m.status}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!within24h && (
        <Card className="m-4 mx-auto max-w-2xl border-amber-500/50 bg-amber-500/10">
          <CardContent className="pt-4 text-sm text-amber-900 dark:text-amber-200">
            <strong>Fuera de la ventana de 24 horas.</strong> WhatsApp solo
            permite mensajes con template aprobado fuera de las 24 hs después
            del último mensaje del usuario. Para responder con texto libre
            necesitás que el usuario te escriba primero.
          </CardContent>
        </Card>
      )}

      <ReplyForm conversationId={conversation.id} />
    </div>
  );
}
