"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import {
  markConversationRead,
  persistMessage,
  sendKapsoText,
} from "@/lib/whatsapp";

const replySchema = z.object({
  conversation_id: z.string().uuid(),
  text: z.string().min(1, "Falta el texto.").max(4000),
});

export async function replyToConversation(input: {
  conversation_id: string;
  text: string;
}) {
  await requireRole(["admin"]);
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    return {
      error:
        "Falta WHATSAPP_PHONE_NUMBER_ID en env vars. Configurá el ID del número de Kapso en Vercel y reintentá.",
    };
  }

  const admin = createAdminClient();
  const { data: convo, error } = await admin
    .from("whatsapp_conversations")
    .select("id, phone_number")
    .eq("id", parsed.data.conversation_id)
    .single();
  if (error || !convo) {
    return { error: "Conversación no encontrada." };
  }

  try {
    const { messageId } = await sendKapsoText(
      phoneNumberId,
      convo.phone_number,
      parsed.data.text,
    );
    await persistMessage({
      conversation_id: convo.id,
      external_id: messageId ?? null,
      direction: "outbound",
      type: "text",
      body: parsed.data.text,
      status: "sent",
    });
    revalidatePath(`/whatsapp/${convo.id}`);
    revalidatePath("/whatsapp");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function markRead(conversationId: string) {
  await requireRole(["admin"]);
  await markConversationRead(conversationId);
  revalidatePath("/whatsapp");
  revalidatePath(`/whatsapp/${conversationId}`);
  return { ok: true };
}
