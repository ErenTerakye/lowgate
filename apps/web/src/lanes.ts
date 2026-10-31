import { MODEL_LANES } from "@lowgate/decisions";

/**
 * Lane colours, fixed per lane and never by rank: categorical slots 1–8 of the
 * reference palette, the autopilot as the grey reference. LIGHT is validated on
 * the white panels, DARK (the same hues stepped for a dark surface) on the
 * black canvas. Magenta and aqua are under 3:1 on white, so every mark there
 * carries its lane's name too. Clef's yellow sits near Laya's orange, so Clef's
 * marks are hollow on the light pages.
 */
const LIGHT: Record<string, string> = {
  autopilot: "#6b7380",
  jev: "#2a78d6",
  laya: "#eb6834",
  "gemma-local": "#1baf7a",
  clef: "#c98500",
  "kev-4b": "#e87ba4",
  "kev-0.8b": "#008300",
  "kev-9b": "#6250d6",
  "kev-27b": "#e34948",
};

const DARK: Record<string, string> = {
  autopilot: "#9aa2ad",
  jev: "#3987e5",
  laya: "#d95926",
  "gemma-local": "#199e70",
  clef: "#c98500",
  "kev-4b": "#d55181",
  "kev-0.8b": "#008300",
  "kev-9b": "#9085e9",
  "kev-27b": "#e66767",
};

export const HOLLOW = new Set(["clef"]);

export const colorOf = (lane: string): string => LIGHT[lane] ?? LIGHT.autopilot!;
export const darkColorOf = (lane: string): string => DARK[lane] ?? DARK.autopilot!;

/** A few characters per lane, for the tags on the course and in the panels. */
const TAG: Record<string, string> = {
  autopilot: "AP",
  jev: "Jev",
  laya: "Laya",
  "gemma-local": "Gem",
  clef: "Clef",
  "kev-4b": "K4",
  "kev-0.8b": "K0.8",
  "kev-9b": "K9",
  "kev-27b": "K27",
};

export const tagOf = (lane: string): string => TAG[lane] ?? lane.slice(0, 4);

/**
 * What kind of pilot a lane is, from the catalog's protocol: System One models
 * give a probability for every move, chat models (LLMs) write their pick as
 * text, and anything outside the catalog is the scripted autopilot.
 */
export type Kind = "systemone" | "llm" | "scripted";

export function kindOf(lane: string): Kind {
  const protocol = MODEL_LANES[lane]?.protocol;
  return protocol === "chat" ? "llm" : protocol === "systemone" ? "systemone" : "scripted";
}

export const KIND_LABEL: Record<Kind, string> = { systemone: "System One model", llm: "LLM", scripted: "Scripted baseline" };

/** How many pilots of each kind are on show. */
function pilotCounts(lanes: readonly string[]): { kind: Kind; n: number; text: string }[] {
  const n = (k: Kind) => lanes.filter((l) => kindOf(l) === k).length;
  return [
    { kind: "systemone" as const, n: n("systemone"), text: n("systemone") === 1 ? " System One model" : " System One models" },
    { kind: "llm" as const, n: n("llm"), text: n("llm") === 1 ? " LLM" : " LLMs" },
    { kind: "scripted" as const, n: n("scripted"), text: n("scripted") === 1 ? " autopilot" : " autopilots" },
  ].filter((c) => c.n > 0);
}

/** "7 System One models, 1 LLM and 1 autopilot", for the page intros. */
export function pilotsPhrase(lanes: readonly string[]): string {
  const counts = pilotCounts(lanes);
  return counts.map((c, i) => `${i === 0 ? "" : i === counts.length - 1 ? " and " : ", "}${c.n}${c.text}`).join("");
}

/** One line telling the two kinds of model apart, for the results intro. */
export const kindsNote = (moves: number): string =>
  `Every model picks one of ${moves} moves each second. <b>System One models</b> give a probability for every move; an <b>LLM</b> is a chat model that writes its pick as text.`;

/** Black or white, whichever reads better on a lane colour (WCAG relative luminance). */
export function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}
