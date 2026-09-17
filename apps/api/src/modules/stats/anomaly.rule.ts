import type { NotEvaluatedReason } from "./eligibility.js";

export type { NotEvaluatedReason } from "./eligibility.js";

export type AnomalyVerdict =
  | { kind: "not-evaluated"; reason: NotEvaluatedReason; n: number }
  | { kind: "normal" }
  | { kind: "anomaly"; side: "high" | "low"; distance: number | null };

interface RuleSettings {
  method: "IQR" | "ZSCORE";
  minN: number;
  iqrMultiplier: number;
  zScoreLimit: number;
}

/**
 * One cohort's statistics, carrying what BOTH methods need.
 *
 * Not a union discriminated by method: the stored document would then hold only
 * the active method's fields, and flipping ANOMALY_METHOD (open value O4, so it
 * is expected to be flipped) would compare against undefined — every comparison
 * NaN, every verdict "normal", nothing flagged, no error anywhere. A dashboard
 * that silently stops flagging is worse than one that says it cannot compare.
 */
export interface PeerBounds {
  n: number;
  q1?: number;
  q3?: number;
  iqr?: number;
  lowBound?: number;
  highBound?: number;
  mean?: number;
  stdDev?: number;
}

type EligibleRecord =
  | { budget: number; eligible: true }
  | { budget: number; eligible: false; reason: NotEvaluatedReason };

export function quantile(values: number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) return sorted[lowerIndex]!;

  // Type 7 makes the chosen quartiles inspectable: n=8 gives p=.25 at 1.75,
  // between 20 and 30 (27.5), and p=.75 at 5.25, between 60 and 70 (62.5).
  const fraction = position - lowerIndex;
  return sorted[lowerIndex]! + fraction * (sorted[upperIndex]! - sorted[lowerIndex]!);
}

export function verdictFor(record: EligibleRecord, bounds: PeerBounds | null, settings: RuleSettings): AnomalyVerdict {
  const n = bounds?.n ?? 0;
  if (!record.eligible) return { kind: "not-evaluated", reason: record.reason, n };
  if (!bounds || bounds.n < settings.minN) return { kind: "not-evaluated", reason: "insufficient-peers", n };

  if (settings.method === "IQR") {
    const { q1, q3, iqr, lowBound, highBound } = bounds;
    if (q1 === undefined || q3 === undefined || iqr === undefined || lowBound === undefined || highBound === undefined) {
      return { kind: "not-evaluated", reason: "stats-unavailable", n };
    }
    if (iqr === 0) return zeroSpreadVerdict(record.budget, q1);
    // Measured from the nearer quartile, not from the fence: "3.1 x IQR" reads
    // as distance from the box, and a value sitting exactly on the fence is
    // then 1.5 — the multiplier itself, which is checkable by eye.
    if (record.budget < lowBound) return { kind: "anomaly", side: "low", distance: (q1 - record.budget) / iqr };
    if (record.budget > highBound) return { kind: "anomaly", side: "high", distance: (record.budget - q3) / iqr };
    return { kind: "normal" };
  }

  const { mean, stdDev } = bounds;
  if (mean === undefined || stdDev === undefined) {
    return { kind: "not-evaluated", reason: "stats-unavailable", n };
  }
  if (stdDev === 0) return zeroSpreadVerdict(record.budget, mean);
  const zScore = (record.budget - mean) / stdDev;
  if (Math.abs(zScore) > settings.zScoreLimit) {
    return { kind: "anomaly", side: zScore < 0 ? "low" : "high", distance: Math.abs(zScore) };
  }
  return { kind: "normal" };
}

function zeroSpreadVerdict(budget: number, peerValue: number): AnomalyVerdict {
  if (budget === peerValue) return { kind: "normal" };
  // A multiple of zero spread has no finite meaning, so the UI receives no distance.
  return { kind: "anomaly", side: budget < peerValue ? "low" : "high", distance: null };
}
