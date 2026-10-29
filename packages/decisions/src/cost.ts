import type { ModelInfo, PriceSource } from "./types.ts";

/** Tokens a lane has used so far, summed by LaneRunner from provider-reported usage. */
export interface UsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Calls that reported usage. */
  readonly calls: number;
}

export interface CostSummary {
  /** Spent so far in this run, USD. */
  readonly spentUsd: number;
  /** At the rate this lane actually decided in this run, not at the full 5 Hz. */
  readonly perHourUsd: number;
  /** Per 1,000 answered calls. Null until a call has reported usage. */
  readonly per1kUsd: number | null;
  readonly source: PriceSource;
}

/** USD for some tokens at a per-million price. */
export function usdFor(inputTokens: number, outputTokens: number, price: ModelInfo["price"]): number {
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

/**
 * Measured tokens times the catalog price. Returns null for lanes with no
 * model (keyboard, scripts), which cost nothing to run and have no price.
 */
export function costSummary(model: ModelInfo | null, usage: UsageTotals, elapsedSeconds: number): CostSummary | null {
  if (!model) return null;
  const spentUsd = usdFor(usage.inputTokens, usage.outputTokens, model.price);
  return {
    spentUsd,
    perHourUsd: elapsedSeconds > 0 ? (spentUsd / elapsedSeconds) * 3600 : 0,
    per1kUsd: usage.calls > 0 ? (spentUsd / usage.calls) * 1000 : null,
    source: model.price.source,
  };
}

/** Dollars at a precision that suits the size: $0.0035, $0.035, $1.24. */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  const digits = Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(usd))));
  return `$${usd.toFixed(digits)}`;
}

/** How each price source reads on screen. */
export const PRICE_SOURCE_TEXT: Readonly<Record<PriceSource, string>> = {
  vendor: "vendor price",
  third_party: "third-party price, not confirmed by the vendor",
  measured: "measured from our bill",
  none: "no per-token price",
};
