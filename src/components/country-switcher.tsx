"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveCountry } from "@/app/actions/set-active-country";
type Country = "AR" | "UY" | "ALL";
export function CountrySwitcher({ country, countries }: { country: Country; countries: Country[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const changeCountry = (value: string) => startTransition(async () => { await setActiveCountry(value); router.refresh(); });
  const className = "h-8 rounded-md border border-border/70 bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring";
  if (countries.length < 2) return null;
  return <>
    <select aria-label="País activo" value={country} disabled={pending} onChange={(event) => changeCountry(event.currentTarget.value)} className={className + " hidden sm:block"}>
      {countries.map(value => <option key={value} value={value}>{{ UY: "Uruguay", AR: "Argentina", ALL: "Todos" }[value]}</option>)}
    </select>
    <select aria-label="País activo" value={country} disabled={pending} onChange={(event) => changeCountry(event.currentTarget.value)} className={className + " sm:hidden"}>
      {countries.map(value => <option key={value} value={value}>{value}</option>)}
    </select>
  </>;
}
