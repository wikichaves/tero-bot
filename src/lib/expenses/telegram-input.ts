import type { TelegramMessage } from "@/lib/telegram";

/** Free photos only in DMs; groups require an explicit expense command. */
export function telegramExpenseInput(msg: TelegramMessage) {
  const text = (msg.text ?? msg.caption ?? "").trim()
    .replace(/^(\/[a-z]+)@\w+\b/i, "$1");
  const match = text.match(/^\/?(?:gasto|expense|subir\s+gasto)\b\s*:?\s*([\s\S]*)$/i);
  const photo = msg.photo?.at(-1);
  const doc = msg.document;
  const attachment = photo
    ? { fileId: photo.file_id, size: photo.file_size, mime: "image/jpeg" }
    : doc && ["image/jpeg", "image/png", "application/pdf"].includes(doc.mime_type ?? "")
      ? { fileId: doc.file_id, size: doc.file_size, mime: doc.mime_type! }
      : null;
  if (!match && !(attachment && msg.chat.type === "private" && !text.startsWith("/"))) return null;
  return {
    text: match ? match[1].trim() : text,
    attachment,
    unsupported: !!doc && !attachment,
    sourceMessageId: `telegram:${msg.chat.id}:${msg.message_id}`,
  };
}

/** Reject mislabeled documents before persisting them. */
export function receiptMatchesMime(bytes: Uint8Array, mime: string): boolean {
  const signatures: Record<string, number[]> = {
    "image/jpeg": [0xff, 0xd8, 0xff],
    "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
  };
  const signature = signatures[mime];
  return !!signature && signature.every((value, index) => bytes[index] === value);
}
