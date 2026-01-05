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

export type ReserveCreditsOk = {
  ok: true;
  tier?: string;
  remaining_monthly?: number;
  remaining_bonus?: number;
  reserved_monthly?: number;
  reserved_bonus?: number;
  status?: string;
  idempotent?: boolean;
} & AnyRecord;

export type ReserveCreditsFail = {
  ok: false;
  reason?: string;
  tier?: string;
  remaining_monthly?: number;
  remaining_bonus?: number;
} & AnyRecord;

export function parseReserveCreditsResult(value: unknown): ReserveCreditsOk | ReserveCreditsFail | null {
  if (!isRecord(value)) return null;
  if (value.ok === true) return value as ReserveCreditsOk;
  if (value.ok === false) return value as ReserveCreditsFail;
  return null;
}

export type CommitReservedCreditsOk = {
  ok: true;
  tier?: string;
  remaining_monthly?: number;
  remaining_bonus?: number;
  idempotent?: boolean;
} & AnyRecord;

export type CommitReservedCreditsFail = {
  ok: false;
  reason?: string;
  tier?: string;
  remaining_monthly?: number;
  remaining_bonus?: number;
} & AnyRecord;

export function parseCommitReservedCreditsResult(value: unknown): CommitReservedCreditsOk | CommitReservedCreditsFail | null {
  if (!isRecord(value)) return null;
  if (value.ok === true) return value as CommitReservedCreditsOk;
  if (value.ok === false) return value as CommitReservedCreditsFail;
  return null;
}

export type ReleaseReservedCreditsOk = {
  ok: true;
  remaining_monthly?: number;
  remaining_bonus?: number;
  already_released?: boolean;
} & AnyRecord;

export type ReleaseReservedCreditsFail = {
  ok: false;
  reason?: string;
} & AnyRecord;

export function parseReleaseReservedCreditsResult(value: unknown): ReleaseReservedCreditsOk | ReleaseReservedCreditsFail | null {
  if (!isRecord(value)) return null;
  if (value.ok === true) return value as ReleaseReservedCreditsOk;
  if (value.ok === false) return value as ReleaseReservedCreditsFail;
  return null;
}
