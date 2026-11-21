"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { agencyCommand } from "./actions";
export function AgencyForm({children,operation,label}:{children:ReactNode;operation:string;label:string}) {
  const [pending,setPending]=useState(false);
  const [result,setResult]=useState<{error?:string;ok?:boolean;feed?:string}>({});
  const router=useRouter(); const t=useTranslations("availability");
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=event.currentTarget;
    setPending(true);setResult({});
    try { const result=await agencyCommand(new FormData(form));setResult(result); if(result.ok) { if(operation==="create" || operation==="block" || operation==="rate") form.reset();router.refresh(); } }
    catch { setResult({error:t("saveError")}); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-3"><input type="hidden" name="operation" value={operation}/><fieldset disabled={pending} className="space-y-3">{children}<Button type="submit" variant="outline">{pending?t("saving"):label}</Button></fieldset><div aria-live="polite" className="break-words text-sm">{result.error || (result.ok?t("saved"):"")}{result.feed && <><p className="mt-2">{t("feedHelp")}</p><code className="block select-all break-all">{window.location.origin}{result.feed}</code></>}</div></form>;
}
