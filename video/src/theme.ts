import { loadFont as loadCondensed } from "@remotion/google-fonts/IBMPlexSansCondensed";
import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";

export const FPS = 60;
export const WIDTH = 1080;
export const HEIGHT = 1350;

/** Display type: condensed, for headlines and big numbers. */
export const DISPLAY = loadCondensed("normal", { weights: ["500", "600"], subsets: ["latin"] }).fontFamily;
/** Body type: the site's own face. */
export const BODY = loadSans("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;

/** A night plotting table: deep blue, a faint grid, gold foil for the craft and the site's dark lane colours for pilots. */
export const C = {
  bg: "#0c1726",
  bgLow: "#09111d",
  grid: "rgba(150, 180, 215, 0.07)",
  gridMajor: "rgba(150, 180, 215, 0.13)",
  ink: "#eef2f6",
  ink2: "#a9b6c6",
  muted: "#6f7f93",
  rule: "rgba(169, 182, 198, 0.28)",
  gold: "#e2ad33",
  goldLight: "#f4d27a",
  goldShadow: "#9c7418",
  pad: "#ffffff",
  regolith: "#1b2636",
  rim: "#5d6b7e",
  flame: "#ffb454",
  flameCore: "#fff4d6",
  good: "#63d39b",
  bad: "#ff7a66",
} as const;

/** The site's lane colours for a dark surface (apps/web/src/lanes.ts), fixed per lane. */
export const LANE_COLOR: Record<string, string> = {
  autopilot: "#9aa2ad",
  jev: "#3987e5",
  laya: "#d95926",
  "gemma-local": "#199e70",
  clef: "#c98500",
  "kev-4b": "#d55181",
  "kev-0.8b": "#2fa52f",
  "kev-9b": "#9085e9",
  "kev-27b": "#e66767",
};

export const KIND: Record<string, string> = {
  autopilot: "Scripted autopilot",
  jev: "System One",
  laya: "System One, trained by me",
  "gemma-local": "LLM",
  clef: "System One",
  "kev-4b": "System One",
  "kev-0.8b": "System One",
  "kev-9b": "System One",
  "kev-27b": "System One",
};
