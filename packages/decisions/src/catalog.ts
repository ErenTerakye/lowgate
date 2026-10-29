import type { ModelInfo } from "./types.ts";

/**
 * Model lanes the arena knows how to call, keyed by lane id. The proxy (Vite
 * in dev, the Worker in production) uses this table to pick the upstream and
 * to force the pinned model, so a browser cannot ask for a different one.
 */
export interface ModelLane {
  readonly id: string;
  readonly label: string;
  readonly protocol: "systemone" | "chat";
  readonly model: ModelInfo;
  readonly upstream: string;
  /** Environment variable holding the upstream key. Never sent to the browser. */
  readonly keyEnv: string;
  /** Where the price was checked, so the README can cite it. */
  readonly priceNote: string;
}

export const MODEL_LANES: Readonly<Record<string, ModelLane>> = {
  jev: {
    id: "jev",
    label: "Jev",
    protocol: "systemone",
    model: {
      provider: "TypeSafe",
      model: "jev-1.14.0",
      pinned: true,
      price: { input: 0.042, output: 0, source: "third_party" },
    },
    upstream: "https://api.typesafe.ai/v1/systemone",
    keyEnv: "TYPESAFE_API_KEY",
    priceNote:
      "TypeSafe's docs publish no price (checked 2026-10-29). $0.042/M input is from third-party reports; output tokens are free per the API docs.",
  },
};
