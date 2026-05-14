// Internal pdf-parse path bypasses the package's index.js which loads a
// test PDF off disk at module init (breaks Next.js production builds).
// `@types/pdf-parse` only declares the package root, not this subpath.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info?: unknown;
    metadata?: unknown;
  }
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}
