import { describe, expect, it } from "vitest";
import { quantile, verdictFor } from "./anomaly.rule.js";

const settings = { method: "IQR" as const, minN: 8, iqrMultiplier: 1.5, zScoreLimit: 3 };
const bounds = (over: Partial<ReturnType<typeof boundsOf>> = {}) => ({ ...boundsOf([10, 20, 30, 40, 50, 60, 70, 80]), ...over });

function boundsOf(values: number[]) {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return { n: values.length, q1, q3, iqr: q3 - q1, lowBound: q1 - 1.5 * (q3 - q1), highBound: q3 + 1.5 * (q3 - q1) };
}

describe("quantile (type 7, linear interpolation)", () => {
  it("matches hand-computed values on an even count", () => {
    expect(quantile([10, 20, 30, 40, 50, 60, 70, 80], 0.25)).toBe(27.5);
    expect(quantile([10, 20, 30, 40, 50, 60, 70, 80], 0.75)).toBe(62.5);
  });
  it("matches hand-computed values on an odd count", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});

describe("verdictFor", () => {
  it("flags a value above the upper fence", () => {
    expect(verdictFor({ budget: 200, eligible: true }, bounds(), settings)).toEqual({
      kind: "anomaly", side: "high", distance: (200 - 62.5) / 35,
    });
  });

  it("flags a value below the lower fence", () => {
    const v = verdictFor({ budget: -100, eligible: true }, bounds(), settings);
    expect(v).toMatchObject({ kind: "anomaly", side: "low" });
  });

  it("does not flag a value exactly on the fence", () => {
    expect(verdictFor({ budget: bounds().highBound, eligible: true }, bounds(), settings).kind).toBe("normal");
  });

  it("does not evaluate below the minimum peer count", () => {
    expect(verdictFor({ budget: 999999, eligible: true }, boundsOf([10, 20, 30, 40, 50, 60, 70]), settings)).toEqual({
      kind: "not-evaluated", reason: "insufficient-peers", n: 7,
    });
  });

  it("evaluates at exactly the minimum peer count", () => {
    expect(verdictFor({ budget: 50, eligible: true }, bounds(), settings).kind).toBe("normal");
  });

  it("calls a different value an anomaly with no distance when every peer is identical", () => {
    const flat = boundsOf([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(verdictFor({ budget: 9, eligible: true }, flat, settings)).toEqual({
      kind: "anomaly", side: "high", distance: null,
    });
    expect(verdictFor({ budget: 5, eligible: true }, flat, settings).kind).toBe("normal");
  });

  it("does not evaluate when there are no bounds at all", () => {
    expect(verdictFor({ budget: 10, eligible: true }, null, settings)).toEqual({
      kind: "not-evaluated", reason: "insufficient-peers", n: 0,
    });
  });

  it("passes an ineligible record straight through with its reason", () => {
    expect(verdictFor({ budget: 10, eligible: false, reason: "unverified-budget" }, bounds(), settings)).toEqual({
      kind: "not-evaluated", reason: "unverified-budget", n: 8,
    });
  });
});

describe("verdictFor under ZSCORE", () => {
  const z = { ...settings, method: "ZSCORE" as const };
  it("flags beyond the limit and is normal within it", () => {
    const b = { n: 8, mean: 50, stdDev: 10 };
    expect(verdictFor({ budget: 95, eligible: true }, b, z)).toMatchObject({ kind: "anomaly", side: "high" });
    expect(verdictFor({ budget: 55, eligible: true }, b, z).kind).toBe("normal");
  });
  it("handles zero standard deviation the same way as zero IQR", () => {
    expect(verdictFor({ budget: 7, eligible: true }, { n: 8, mean: 5, stdDev: 0 }, z)).toEqual({
      kind: "anomaly", side: "high", distance: null,
    });
  });

  it("says so when the cohort has no z-score statistics, instead of reporting everything normal", () => {
    // The failure this guards: flipping ANOMALY_METHOD (open value O4) against
    // bounds computed for IQR. Undefined mean and standard deviation make every
    // comparison NaN, and NaN comparisons are false — so nothing is ever
    // flagged and nothing ever errors.
    expect(verdictFor({ budget: 999_999, eligible: true }, bounds(), z)).toEqual({
      kind: "not-evaluated", reason: "stats-unavailable", n: 8,
    });
  });
});

describe("verdictFor under IQR with statistics missing", () => {
  it("reports the fault rather than calling an outlier normal", () => {
    expect(verdictFor({ budget: 999_999, eligible: true }, { n: 8, mean: 50, stdDev: 10 }, settings)).toEqual({
      kind: "not-evaluated", reason: "stats-unavailable", n: 8,
    });
  });
});
