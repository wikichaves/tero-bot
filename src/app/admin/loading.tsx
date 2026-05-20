import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Generic placeholder shared by every /admin/* page (alarmas,
 * properties, tuya, tuya/lock, tuya/scenes, tuya/diagnostico, users,
 * whatsapp). Each page has its own header + a table/list, so a single
 * "header + card with rows" is a good-enough approximation.
 */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-9 w-32" />
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="ml-auto h-8 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
