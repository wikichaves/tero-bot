import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth";
import { availabilityViewer } from "@/lib/availability/data";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export default async function AvailabilityLayout({ children }: { children: React.ReactNode }) {
  const viewer = await availabilityViewer();
  const user = await requireUser();
  const db = await createClient();
  const { data: profile, error } = await db.from("profiles")
    .select("id,email,full_name,role,whatsapp,created_at,language,telegram_chat_id")
    .eq("id", user.id).single();
  if (error || !profile) throw new Error("Unable to verify access");
  return <div className="flex flex-1 flex-col">
    <SiteHeader profile={profile as Profile} countryScope={viewer.ids} />
    {children}
  </div>;
}
