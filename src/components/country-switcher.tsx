"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveCountry } from "@/app/actions/set-active-country";
export function CountrySwitcher({ country }: { country: "AR" | "UY" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <select aria-label="País activo" value={country} disabled={pending} onChange={(event) => startTransition(async () => { await setActiveCountry(event.currentTarget.value); router.refresh(); })} className="h-8 rounded-md border border-border/70 bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring">
    <option value="UY">Uruguay</option><option value="AR">Argentina</option>
  </select>;
}
