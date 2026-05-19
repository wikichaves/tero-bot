/**
 * Tipos compartidos entre el server component `page.tsx` y los client
 * components (`device-energy-card.tsx` etc). Mantenemos los tipos en un
 * archivo aparte porque `@/lib/tuya/energy` es `server-only` y no se
 * puede importar desde cliente.
 */

export type EnergyReading = {
  power_w: number | null;
  voltage_v: number | null;
  current_a: number | null;
  total_energy_kwh: number | null;
};

export type EnergyCostEstimate = {
  total_cost: number | null;
  daily_cost_at_current: number | null;
  hourly_cost_at_current: number | null;
  tariff_per_kwh: number;
  currency: string;
};
