/**
 * Pure task-description formatting helpers. Lives outside the
 * `server-only` modules so client components (e.g. `MyTaskCard`) can
 * import the same parser the server uses to write the format.
 */

/**
 * Pull `📸 Foto: <url>` blocks out of a task description (the format the
 * WhatsApp create-task flow writes). Returns the URLs and the description
 * with those blocks stripped, so listings can show the meaningful text
 * and render the photos separately.
 */
export function extractPhotos(description: string | null | undefined): {
  urls: string[];
  cleaned: string;
} {
  if (!description) return { urls: [], cleaned: "" };
  const urls: string[] = [];
  const cleaned = description
    .replace(/^📸\s*Foto:\s*(\S+)\s*$/gm, (_, url) => {
      urls.push(url);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { urls, cleaned };
}
