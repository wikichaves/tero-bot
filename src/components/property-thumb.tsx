"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { propertyThumbnailUrl } from "@/lib/properties/thumbnails";

/**
 * Thumbnail or placeholder for a property. Uses the convention-based URL
 * (`property-thumbnails/<id>`) and falls back to a building icon when the
 * underlying file doesn't exist (the bucket returns 404 → onError).
 *
 * Sizes are in rem so the bumped html font-size scales them too.
 */
export function PropertyThumb({
  propertyId,
  cacheBuster,
  size = "sm",
  alt = "",
}: {
  propertyId: string;
  /** Any string that changes when the thumbnail does — e.g. property's
   *  created_at, or a manually-bumped revision number. */
  cacheBuster?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = propertyThumbnailUrl(propertyId, cacheBuster);
  const dimClass = {
    xs: "h-6 w-6",
    sm: "h-9 w-9",
    md: "h-14 w-14",
    lg: "h-24 w-24",
  }[size];
  const iconClass = {
    xs: "h-3 w-3",
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-10 w-10",
  }[size];

  if (failed || !url) {
    return (
      <div
        className={`${dimClass} flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground`}
        aria-hidden="true"
      >
        <Building2 className={iconClass} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className={`${dimClass} shrink-0 rounded-md object-cover`}
      onError={() => setFailed(true)}
    />
  );
}
