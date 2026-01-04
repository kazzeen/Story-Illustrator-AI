type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ConsumeCreditsOk = {
  ok: true;
  tier?: string;
  unlimited?: boolean;
  remaining_monthly?: number;
  remaining_bonus?: number;
} & AnyRecord;

export type ConsumeCreditsFail = {
  ok: false;
  reason?: string;
  tier?: string;
  remaining_monthly?: number;
  remaining_bonus?: number;
} & AnyRecord;

export function parseConsumeCreditsResult(value: unknown): ConsumeCreditsOk | ConsumeCreditsFail | null {
  if (!isRecord(value)) return null;
  if (value.ok === true) return value as ConsumeCreditsOk;
  if (value.ok === false) return value as ConsumeCreditsFail;
  return null;
}

