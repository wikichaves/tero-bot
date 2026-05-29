"use client";

import { useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { replyToConversation } from "./actions";

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const t = useTranslations("whatsappReply");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = String(formData.get("text") ?? "").trim();
    if (!text) return;

    startTransition(async () => {
      const result = await replyToConversation({
        conversation_id: conversationId,
        text,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      formRef.current?.reset();
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="flex items-end gap-2 border-t bg-background p-3"
    >
      <textarea
        name="text"
        rows={2}
        required
        placeholder={t("placeholder")}
        className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
          }
        }}
      />
      <Button type="submit" disabled={pending}>
        {pending ? t("sending") : t("send")}
      </Button>
    </form>
  );
}
