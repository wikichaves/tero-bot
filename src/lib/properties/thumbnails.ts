/**
 * Build the public URL for a property's thumbnail. Uses a convention-based
 * path (`property-thumbnails/<property_id>`) so we don't need a DB column to
 * track upload state.
 *
 * The URL is always returned, even for properties that haven't uploaded a
 * thumbnail yet — callers should use `<img onError>` (via PropertyThumb) to
 * fall back to a placeholder when Storage 404s.
 *
 * The `v` cache-buster (using created_at as a stable-but-property-specific
 * value) means a freshly-uploaded thumbnail shows up immediately even if a
 * previous version was cached by the browser.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const BUCKET = "property-thumbnails";

export function propertyThumbnailUrl(
  propertyId: string,
  cacheBuster?: string | null,
): string | null {
  if (!SUPABASE_URL) return null;
  const base = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${propertyId}`;
  if (!cacheBuster) return base;
  // Keep the buster short and URL-safe.
  const v = encodeURIComponent(cacheBuster.slice(0, 32));
  return `${base}?v=${v}`;
}
