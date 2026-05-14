import "server-only";

/**
 * Extract plain text from a PDF buffer.
 *
 * We import `pdf-parse/lib/pdf-parse.js` directly (not the package root)
 * because the package's entry file tries to load a sample PDF off disk
 * for self-testing at module init — that crashes Next.js production
 * builds. The internal module skips that.
 *
 * pdf-parse returns text without preserving columns/tables — utility
 * bills become a single long string with newlines, which is fine for
 * the regex-based extractors in `parse-email.ts` (we already treat
 * the email body the same way).
 *
 * On any error we return null and log: the caller falls back to whatever
 * was already extracted from the email body, so a malformed/encrypted
 * PDF doesn't break ingestion.
 */
// pdf-parse has no ESM build; CJS interop via the dynamic import works
// inside server-only code paths.

const PDF_PARSE_TIMEOUT_MS = 5_000;

export async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    const pdf = (await import("pdf-parse/lib/pdf-parse.js")).default as (
      data: Buffer,
    ) => Promise<{ text: string; numpages: number }>;
    // Cap each PDF at 5s so one weird/corrupt attachment can't hang the
    // whole inbound webhook (Postmark abandons us after 10s).
    const result = await Promise.race([
      pdf(buffer),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`pdf-parse timeout after ${PDF_PARSE_TIMEOUT_MS}ms`)),
          PDF_PARSE_TIMEOUT_MS,
        ),
      ),
    ]);
    return result.text ?? null;
  } catch (err) {
    console.error("[pdf-parse] failed", (err as Error).message);
    return null;
  }
}
