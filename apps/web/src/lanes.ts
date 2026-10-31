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
