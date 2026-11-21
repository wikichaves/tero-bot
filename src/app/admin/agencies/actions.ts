"use server";
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rangeSchema, rateSchema } from "@/lib/availability/core";

const uuid = z.string().uuid();
const agencySchema = z.object({ name:z.string().trim().min(1).max(100), email:z.email(), phone:z.string().regex(/^\+[1-9]\d{7,14}$/), password:z.string().min(12).max(128) });
export async function agencyCommand(form: FormData): Promise<{ error?:string; ok?:boolean; feed?:string }> {
  await requireRole(["admin"]);
  const t = await getTranslations("availability");
  const db = createAdminClient();
  const operation = String(form.get("operation"));
  const fail = () => ({error:t("saveError")});
  try {
    if (operation === "create") {
      const v = agencySchema.parse(Object.fromEntries(form));
      const ids = z.array(uuid).parse(form.getAll("properties"));
      const { data, error } = await db.auth.admin.createUser({ email:v.email,password:v.password,email_confirm:true,ban_duration:"876000h",user_metadata:{full_name:v.name} });
      if (error || !data.user) return fail();
      const id=data.user.id;
      const profile = await db.from("profiles").update({role:"agency",full_name:v.name,whatsapp:v.phone}).eq("id",id).select("id").single();
      const agency = profile.error ? profile : await db.from("agencies").insert({profile_id:id,name:v.name,email:v.email,phone:v.phone});
      const access = agency.error ? agency : await db.rpc("set_agency_access", {p_profile:id,p_properties:ids,p_active:true});
      if (access.error) { await db.auth.admin.deleteUser(id); return fail(); }
      // The account cannot sign in while the default profile role is being
      // replaced. A provisioning failure leaves it banned (fail closed).
      const { error: activationError } = await db.auth.admin.updateUserById(id,{ban_duration:"none"});
      if (activationError) { await db.auth.admin.deleteUser(id); return fail(); }
    } else if (operation === "access") {
      const id=uuid.parse(form.get("profile_id"));
      const ids=z.array(uuid).parse(form.getAll("properties"));
      const {error}=await db.rpc("set_agency_access",{p_profile:id,p_properties:ids,p_active:form.get("active")==="on"});
      if(error) return fail();
    } else if (operation === "rate" || operation === "block" || operation === "feed") {
      const property_id=uuid.parse(form.get("property_id"));
      const {data:property,error}=await db.from("properties").select("id").eq("id",property_id).eq("is_rental",true).maybeSingle();
      if(error || !property) return fail();
      if(operation === "feed") {
        const token=randomBytes(32).toString("hex");
        const {error}=await db.from("availability_feeds").upsert({property_id,token_hash:createHash("sha256").update(token).digest("hex")});
        if(error) return fail();
        revalidatePath("/admin/agencies");
        return {ok:true,feed:`/api/availability/ical/${token}`};
      }
      const parsed=(operation==="rate"?rateSchema:rangeSchema).parse(Object.fromEntries(form));
      const {error:save}=await db.from(operation==="rate"?"seasonal_rates":"availability_blocks").insert(parsed);
      if(save) return {error:save.code==="23P01"?t("overlap"):t("saveError")};
    } else if (operation === "deleteRate" || operation === "deleteBlock" || operation === "revokeFeed") {
      const id=uuid.parse(form.get("id"));
      const table=operation==="deleteRate"?"seasonal_rates":operation==="deleteBlock"?"availability_blocks":"availability_feeds";
      const {error}=await db.from(table).delete().eq(operation==="revokeFeed"?"property_id":"id",id);
      if(error) return fail();
    } else return fail();
    revalidatePath("/availability"); revalidatePath("/admin/agencies");
    return {ok:true};
  } catch { return {error:t("invalid")}; }
}
