"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveCountry } from "@/app/actions/set-active-country";
export function CountrySwitcher({ country }: { country: "AR" | "UY" | "ALL" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const changeCountry = (value: string) => startTransition(async () => { await setActiveCountry(value); router.refresh(); });
  const className = "h-8 rounded-md border border-border/70 bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring";
  return <>
    <select aria-label="País activo" value={country} disabled={pending} onChange={(event) => changeCountry(event.currentTarget.value)} className={className + " hidden sm:block"}>
      <option value="UY">Uruguay</option><option value="AR">Argentina</option><option value="ALL">Todos</option>
    </select>
    <select aria-label="País activo" value={country} disabled={pending} onChange={(event) => changeCountry(event.currentTarget.value)} className={className + " sm:hidden"}>
      <option value="UY">UY</option><option value="AR">AR</option><option value="ALL">ALL</option>
    </select>
  </>;
}
