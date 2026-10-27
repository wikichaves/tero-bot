import "server-only";

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/** Never persist/log Telegram file URLs: they contain the bot token. */
export async function downloadTelegramReceipt(token: string, fileId: string): Promise<Buffer> {
  try {
    const metadata = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }), signal: AbortSignal.timeout(15000),
    });
    if (!metadata.ok) throw new Error();
    const file = await metadata.json() as { ok: boolean; result?: { file_path?: string; file_size?: number } };
    const path = file.result?.file_path;
    if (!file.ok || !path || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.includes("..") || (file.result?.file_size ?? 0) > MAX_RECEIPT_BYTES) throw new Error();
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_RECEIPT_BYTES) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RECEIPT_BYTES) { await reader.cancel(); throw new Error(); }
      chunks.push(chunk.value);
    }
    if (!size) throw new Error();
    return Buffer.concat(chunks);
  } catch {
    throw new Error("No se pudo descargar el comprobante de Telegram (máximo 10 MB).");
  }
}
