import { cn } from "@/lib/utils";

/**
 * Skeleton placeholder for loading content. Use to hold space while
 * server-fetched data streams in (typically rendered from a route-level
 * `loading.tsx`). Picks up the theme's muted color + tw-animate-css
 * `animate-pulse` keyframe so it looks consistent with the rest of the
 * surface.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
