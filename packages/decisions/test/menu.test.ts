import { MANOEUVRES, MENU_TILTS, createLane } from "@arena/engine";
import { describe, expect, it } from "vitest";
import { LLM_PROMPTS, OPTION_KEYS, PROMPTS, describeManoeuvre, observePrompt, optionIndex, tiltBand, tiltBandText } from "../src/index.ts";

describe("menu wording", () => {
  it("gives every manoeuvre a unique key, in menu order", () => {
    expect(new Set(OPTION_KEYS).size).toBe(MANOEUVRES.length);
    expect(OPTION_KEYS.slice(0, 2)).toEqual(["L30-T0", "L30-T1"]);
    expect(OPTION_KEYS[optionIndex("UP-T2")]).toBe("UP-T2");
    expect(MANOEUVRES[optionIndex("r15-t3")]).toEqual({ tilt: 15, throttle: 3 });
    expect(optionIndex("UP-T5")).toBe(-1);
  });

  it("describes manoeuvres in the observation's units", () => {
    expect(describeManoeuvre({ tilt: 15, throttle: 3 })).toBe("Tilt 15 deg right, throttle 3 of 4");
    expect(describeManoeuvre({ tilt: 0, throttle: 0 })).toBe("Upright, throttle 0 of 4 (engine off)");
    expect(describeManoeuvre({ tilt: -5, throttle: 4 })).toBe("Tilt 5 deg left, throttle 4 of 4 (full)");
  });

  it("splits the good-tilt range halfway between menu tilts, with no gaps", () => {
    expect(tiltBand(-30)).toEqual({ low: null, high: -22.5 });
    expect(tiltBand(0)).toEqual({ low: -2.5, high: 2.5 });
    expect(tiltBandText(30)).toBe("above 22.5 deg");
    for (let i = 1; i < MENU_TILTS.length; i++) expect(tiltBand(MENU_TILTS[i]!).low).toBe(tiltBand(MENU_TILTS[i - 1]!).high);
  });

  it("asks System One one choice over the whole menu", () => {
    for (const spec of Object.values(PROMPTS)) {
      expect(spec.questions.manoeuvre.type).toBe("choice");
      expect(Object.keys(spec.questions.manoeuvre.criteria)).toEqual(OPTION_KEYS);
    }
  });

  it("lists every key in the chat prompts", () => {
    for (const spec of Object.values(LLM_PROMPTS)) for (const key of OPTION_KEYS) expect(spec.system).toContain(`${key}: `);
  });

  it("keeps Laya's prompt well inside its 512-token context", () => {
    const { questions } = PROMPTS.m3;
    const text = observePrompt(createLane(42), PROMPTS.m3) + questions.manoeuvre.instructions + Object.entries(questions.manoeuvre.criteria).flat().join(" ");
    // ~4 characters per English token; a generous bound.
    expect(text.length / 3).toBeLessThan(400);
  });
});
