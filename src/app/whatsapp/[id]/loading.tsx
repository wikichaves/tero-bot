import { Skeleton } from "@/components/ui/skeleton";

/**
 * /whatsapp/[id] placeholder. Live layout: chat header + alternating
 * message bubbles + composer.
 */
export default function WhatsAppThreadLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {[0, 1, 0, 1, 1, 0].map((side, i) => (
          <div
            key={i}
            className={
              side === 0
                ? "flex justify-start"
                : "flex justify-end"
            }
          >
            <Skeleton
              className="h-12 rounded-xl"
              style={{ width: `${40 + ((i * 17) % 30)}%` }}
            />
          </div>
        ))}
      </div>

      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}
