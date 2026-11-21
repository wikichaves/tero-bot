import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { exportCalendar } from "@/lib/availability/core";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{token:string}> }) {
  const {token}=await params;
  const headers={"Cache-Control":"private, no-store", "Referrer-Policy":"no-referrer", "X-Robots-Tag":"noindex, nofollow"};
  if(!/^[a-f0-9]{64}$/.test(token)) return new Response(null,{status:404,headers});
  const db=createAdminClient();
  const {data:feed,error}=await db.from("availability_feeds").select("property_id").eq("token_hash",createHash("sha256").update(token).digest("hex")).maybeSingle();
  if(error) return new Response(null,{status:503,headers});
  if(!feed) return new Response(null,{status:404,headers});
  const {data:property,error:pe}=await db.from("properties").select("is_rental").eq("id",feed.property_id).single();
  if(pe) return new Response(null,{status:503,headers});
  if(!property.is_rental) return new Response(null,{status:404,headers});
  const events: {id:string;start_date:string;end_date:string}[]=[];
  for (const table of ["reservations","availability_blocks"] as const) {
    for(let offset=0; ; offset+=500) {
      if(offset>=10000) return new Response(null,{status:503,headers});
      let q=db.from(table).select(table==="reservations"?"id,check_in,check_out":"id,start_date,end_date").eq("property_id",feed.property_id);
      if(table==="reservations") q=q.eq("source","manual").neq("status","cancelled");
      const {data,error}=await q.order("id").range(offset,offset+499);
      if(error) return new Response(null,{status:503,headers});
      for(const item of data ?? []) {
        const row=item as unknown as Record<string,string>;
        events.push({id:row.id,start_date:row.start_date ?? row.check_in,end_date:row.end_date ?? row.check_out});
      }
      if((data?.length ?? 0)<500) break;
    }
  }
  return new Response(exportCalendar(events),{headers:{...headers,"Content-Type":"text/calendar; charset=utf-8"}});
}
