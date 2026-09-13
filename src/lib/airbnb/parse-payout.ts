import { createHash } from "node:crypto";

export type PayoutItem = { reservation_code: string; listing_id: string; guest_name: string; check_in: string; check_out: string; amount: number; currency: string };
export type AirbnbPayout = { key: string; paid_on: string; deposit_amount: number; deposit_currency: string; items: PayoutItem[] };
export const isPayoutNotice = (value: string) => /(?:we sent a payout|te enviamos un cobro|was sent today|hoy te enviamos)/i.test(value);

function money(value: string) {
  const normalized = value.includes(",") && value.lastIndexOf(",") > value.lastIndexOf(".")
    ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error("Invalid payout amount");
  return Math.round(n * 100);
}
function iso(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}
function dates(start: string, end: string, english: boolean) {
  const a = start.split("/").map(Number), b = end.split("/").map(Number);
  const candidates = [true, false].flatMap(md => {
    const x = iso(a[2], a[md ? 0 : 1], a[md ? 1 : 0]);
    const y = iso(b[2], b[md ? 0 : 1], b[md ? 1 : 0]);
    return x && y && x < y ? [{ x, y, md }] : [];
  });
  const unique = candidates.filter((v, i) => candidates.findIndex(w => w.x === v.x && w.y === v.y) === i);
  const selected = unique.length === 1 ? unique[0] : english ? unique.find(v => v.md) : null;
  if (!selected) throw new Error("Ambiguous payout stay dates");
  return [selected.x, selected.y];
}
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Fail closed on incomplete notices; never count text and HTML representations twice. */
export function parsePayout(text: string): AirbnbPayout {
  const body = text.replace(/\r/g, "");
  const english = /Your money was sent on/i.test(body);
  const sent = body.match(/Your money was sent on\s+(\w+)\s+(\d+)[\s\S]*?arrive by\s+(\w+)\s+\d+,?\s+(20\d{2})/i);
  const enviado = body.match(/Tu dinero se envi[oó] el\s+(\d+) de (\w+)[\s\S]*?antes del\s+\d+ de\s+(\w+) de\s+(20\d{2})/i);
  const date = sent || enviado;
  if (!date) throw new Error("Missing payout date");
  const m = english ? months.indexOf(date[1].toLowerCase()) + 1 : meses.indexOf(date[2].toLowerCase()) + 1;
  const arrivalMonth = (english ? months : meses).indexOf(date[3].toLowerCase()) + 1;
  const year = Number(date[4]) - (m > arrivalMonth ? 1 : 0);
  const paid_on = iso(year, m, Number(date[english ? 2 : 1]));
  if (!paid_on || !m || !arrivalMonth) throw new Error("Invalid payout date");
  const section = body.match(/(?:^|\n)\s*(?:Details|Detalles)\s*\n([\s\S]*?)(?:Total paid|Total pagado)\s*:\s*\n?\s*\$U?\s*([\d.,]+)\s+([A-Z]{3})/i);
  if (!section) throw new Error("Missing payout details/total");
  const lines = section[1].split("\n").map(x => x.trim()).filter(Boolean);
  const items: PayoutItem[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const amount = lines[i].match(/^(-?)\$\s*([\d.,]+)\s+([A-Z]{3})$/);
    if (!amount) continue;
    const stay = lines[i + 1]?.match(/(?:Home|Accommodation|Alojamiento|Cobro como coanfitri[oó]n|Co-host payout)\s*[•·]\s*(\d{1,2}\/\d{1,2}\/20\d{2})\s*-\s*(\d{1,2}\/\d{1,2}\/20\d{2})/i);
    let j = i + 2;
    while (j < lines.length && !/^H[A-Z0-9]{6,12}$/.test(lines[j])) j++;
    const listing = lines.slice(i + 2, j).join(" ").match(/\((\d+)\)\s*$/);
    if (!stay || !listing || !lines[j] || !lines[i - 1]) throw new Error("Incomplete payout item");
    const [check_in, check_out] = dates(stay[1], stay[2], english);
    items.push({ reservation_code: lines[j], listing_id: listing[1], guest_name: lines[i - 1], check_in, check_out, amount: money(amount[2]) * (amount[1] ? -1 : 1) / 100, currency: amount[3].toUpperCase() });
    consumed.add(j);
  }
  if (!items.length || lines.some((l, i) => /^H[A-Z0-9]{6,12}$/.test(l) && !consumed.has(i))) throw new Error("Unparsed payout items");
  const deposit_amount = money(section[2]) / 100, deposit_currency = section[3].toUpperCase();
  const explicit = body.match(/Payout ID\s*\n\s*([A-Za-z0-9]+)/)?.[1];
  const account = body.match(/(?:Airbnb account ID|Identificador de la cuenta de Airbnb)\s*\n\s*(\d+)/)?.[1];
  if (!explicit && !account) throw new Error("Missing payout identity");
  const canonical = JSON.stringify([account, paid_on, deposit_currency, deposit_amount, items.map(x => JSON.stringify(x)).sort()]);
  return { key: explicit ? `airbnb:${explicit}` : `sha256:${createHash("sha256").update(canonical).digest("hex")}`, paid_on, deposit_amount, deposit_currency, items };
}
