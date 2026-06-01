import "server-only";
import { tuyaFetch } from "./client";

/**
 * WIK-281: lectura del DP `fault` de breakers dlq (ETU9) vía device logs.
 *
 * El breaker reporta cortes de luz como un fault de subtensión/outage. A
 * diferencia del estado `online` (que no cambia si el modem sobrevive por UPS,
 * y que tarda ~3min en detectarse), los device logs guardan CADA transición
 * del DP con timestamp exacto — así captamos micro-cortes de ~5s de forma
 * retroactiva, aunque hayan empezado y terminado entre dos corridas del cron.
 *
 * Docs: https://developer.tuya.com/en/docs/cloud/f1ca997d52?id=Kawfjj7n8tdcw
 */

export type TuyaLogEntry = {
  code: string;
  /** Valor del DP serializado como string (para `fault` es el bitmap entero). */
  value: string;
  /** Epoch en milisegundos del evento. */
  event_time: number;
};

type LogsResponse = {
  logs?: { code: string; value: string; event_time: number }[];
  has_next?: boolean;
  current_row_key?: string;
};

/**
 * Bits del DP `fault` (bitmap entero). Los marcados `powerLoss` implican que
 * el breaker dejó de tener tensión de línea — eso es lo que tratamos como
 * "corte de luz". El resto (sobrecarga, fuga, etc.) son fallas eléctricas que
 * NO son un corte y no disparan la alarma de power-outage.
 */
const FAULT_BITS: Record<number, { label: string; powerLoss?: boolean }> = {
  0x0001: { label: "short_circuit" },
  0x0002: { label: "overload" },
  0x0004: { label: "leakage_current" },
  0x0008: { label: "over_temperature" },
  0x0010: { label: "over_current" },
  0x0020: { label: "unbalance" },
  0x0040: { label: "over_voltage" },
  0x0080: { label: "undervoltage", powerLoss: true },
  0x0100: { label: "phase_loss", powerLoss: true },
  0x0200: { label: "outage", powerLoss: true },
  0x0400: { label: "magnetism" },
};

export type DecodedFault = {
  code: number;
  labels: string[];
  isPowerLoss: boolean;
};

/** Decodifica el bitmap `fault` en labels legibles + si implica corte de luz. */
export function decodeFault(code: number): DecodedFault {
  if (!Number.isFinite(code) || code <= 0) {
    return { code: code > 0 ? code : 0, labels: [], isPowerLoss: false };
  }
  const labels: string[] = [];
  let isPowerLoss = false;
  for (let bit = 0; bit < 31; bit++) {
    const mask = 1 << bit;
    if ((code & mask) === 0) continue;
    const known = FAULT_BITS[mask];
    if (known) {
      labels.push(known.label);
      if (known.powerLoss) isPowerLoss = true;
    } else {
      labels.push(`bit${bit}`);
    }
  }
  return { code, labels, isPowerLoss };
}

/**
 * Trae los logs del DP `fault` del device en [startMs, endMs], en orden
 * cronológico ascendente. Pagina por has_next/current_row_key (cap a 20
 * páginas = 2000 entradas, más que suficiente para una ventana de cron).
 */
export async function getDeviceFaultLogs(
  deviceId: string,
  startMs: number,
  endMs: number,
): Promise<TuyaLogEntry[]> {
  const out: TuyaLogEntry[] = [];
  let rowKey: string | undefined;

  for (let page = 0; page < 20; page++) {
    const query: Record<string, string | number> = {
      start_time: startMs,
      end_time: endMs,
      // type=7 → "Data report" (reportes de DP). Es donde aparece `fault`.
      type: 7,
      // Filtra server-side solo el DP `fault`: sin esto el endpoint devuelve
      // TODOS los reportes (voltaje/corriente/energía…), miles por ventana →
      // pagina 20 veces y choca el rate limit "log query too frequent".
      codes: "fault",
      size: 100,
    };
    if (rowKey) query.start_row_key = rowKey;

    const res = await tuyaFetch<LogsResponse>(
      "GET",
      `/v1.0/devices/${deviceId}/logs`,
      { query },
    );

    for (const e of res.logs ?? []) {
      if (e.code === "fault") {
        out.push({ code: e.code, value: e.value, event_time: e.event_time });
      }
    }

    if (!res.has_next || !res.current_row_key) break;
    rowKey = res.current_row_key;
  }

  out.sort((a, b) => a.event_time - b.event_time);
  return out;
}
