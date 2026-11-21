import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AgencyForm } from "./form";
export default async function AgenciesPage() {
  await requireRole(["admin"]); const t=await getTranslations("availability"); const db=createAdminClient();
  const results=await Promise.all([
    db.from("properties").select("id,name,country").eq("is_rental",true).order("sort_order"),
    db.from("agencies").select("profile_id,name,email,phone,active").order("name"),
    db.from("agency_properties").select("profile_id,property_id"),
    db.from("seasonal_rates").select("id,property_id,start_date,end_date,amount,currency").order("start_date"),
    db.from("availability_blocks").select("id,property_id,start_date,end_date").order("start_date"),
    db.from("availability_feeds").select("property_id"),
  ]);
  if(results.some(r=>r.error || (r.data?.length ?? 0)>=1000)) throw new Error(t("loadError"));
  const [properties,agencies,access,rates,blocks,feeds]=results.map(r=>r.data ?? []) as [Array<{id:string;name:string;country:string}>,Array<{profile_id:string;name:string;email:string;phone:string;active:boolean}>,Array<{profile_id:string;property_id:string}>,Array<{id:string;property_id:string;start_date:string;end_date:string;amount:number;currency:string}>,Array<{id:string;property_id:string;start_date:string;end_date:string}>,Array<{property_id:string}>];
  const input="mt-1 block w-full rounded-md border bg-background p-2";
  const choices=(id?:string)=><fieldset className="flex flex-wrap gap-3"><legend className="mb-2 text-sm">{t("properties")}</legend>{properties.map(p=><label className="flex items-center gap-2 text-sm" key={p.id}><input type="checkbox" name="properties" value={p.id} defaultChecked={access.some(a=>a.profile_id===id&&a.property_id===p.id)}/>{p.name} · {p.country}</label>)}</fieldset>;
  const propertySelect=<label className="block text-sm">{t("property")}<select name="property_id" required className={input}>{properties.map(p=><option value={p.id} key={p.id}>{p.name} · {p.country}</option>)}</select></label>;
  const dates=<div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-sm">{t("start")}<input type="date" name="start_date" required className={input}/></label><label className="text-sm">{t("end")}<input type="date" name="end_date" required className={input}/></label></div>;
  return <div className="space-y-8"><header><h1 className="text-4xl">{t("manage")}</h1><Link className="mt-2 inline-block underline" href="/availability">{t("title")}</Link></header>
    <section className="space-y-4 rounded-xl border p-4"><h2 className="text-2xl">{t("newAgency")}</h2><AgencyForm operation="create" label={t("create")}><div className="grid gap-3 sm:grid-cols-2">{(["name","email","phone","password"] as const).map(key=><label className="text-sm" key={key}>{t(key)}<input className={input} name={key} type={key==="password"?"password":key==="email"?"email":"text"} autoComplete={key==="password"?"new-password":"off"} required minLength={key==="password"?12:1}/></label>)}</div><p className="text-xs text-muted-foreground">{t("credentialsHelp")}</p>{choices()}</AgencyForm></section>
    {agencies.map(a=><section className="space-y-3 rounded-xl border p-4" key={a.profile_id}><h2 className="text-2xl">{a.name}</h2><p className="break-words text-sm">{a.email} · {a.phone}</p><AgencyForm operation="access" label={t("save")}><input type="hidden" name="profile_id" value={a.profile_id}/><label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={a.active}/>{t("active")}</label>{choices(a.profile_id)}</AgencyForm></section>)}
    <div className="grid gap-6 md:grid-cols-2"><section className="space-y-4 rounded-xl border p-4"><h2 className="text-2xl">{t("rates")}</h2><AgencyForm operation="rate" label={t("addRate")}>{propertySelect}{dates}<label className="block text-sm">{t("amount")}<input className={input} name="amount" type="number" min="0.01" step="0.01" required/></label><label className="block text-sm">{t("currency")}<select className={input} name="currency">{["USD","UYU","ARS"].map(c=><option key={c}>{c}</option>)}</select></label></AgencyForm></section>
    <section className="space-y-4 rounded-xl border p-4"><h2 className="text-2xl">{t("blocks")}</h2><AgencyForm operation="block" label={t("addBlock")}>{propertySelect}{dates}</AgencyForm></section></div>
    <p className="text-xs text-muted-foreground">{t("exclusiveEnd")}</p>
    {[...rates.map(r=>({...r,type:"deleteRate"})),...blocks.map(b=>({...b,amount:null,currency:null,type:"deleteBlock"}))].map(r=><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" key={r.id}><p className="text-sm">{properties.find(p=>p.id===r.property_id)?.name} · {r.start_date} → {r.end_date} · {r.amount!==null?`${r.currency} ${r.amount}`:t("block")}</p><AgencyForm operation={r.type} label={t("remove")}><input type="hidden" name="id" value={r.id}/></AgencyForm></div>)}
    <section className="space-y-4 rounded-xl border p-4"><h2 className="text-2xl">{t("feeds")}</h2><p className="text-sm text-muted-foreground">{t("icalHelp")}</p><AgencyForm operation="feed" label={t("rotateFeed")}>{propertySelect}</AgencyForm>{feeds.map(f=><div key={f.property_id} className="border-t pt-3"><p className="mb-2 text-sm">{properties.find(p=>p.id===f.property_id)?.name}</p><AgencyForm operation="revokeFeed" label={t("revokeFeed")}><input type="hidden" name="id" value={f.property_id}/></AgencyForm></div>)}</section>
  </div>;
}
