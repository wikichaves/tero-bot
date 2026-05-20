import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

/**
 * /whatsapp placeholder. Live layout: title + list of conversation rows
 * with avatar/name/last-message/timestamp.
 */
export default function WhatsAppLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-32" />

      <Card>
        <div className="divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
