import { MANOEUVRES, MENU_TILTS, createLane } from "@arena/engine";
import { describe, expect, it } from "vitest";
import { LLM_PROMPTS, OPTION_KEYS, PROMPTS, TILT_KEYS, describeManoeuvre, observePrompt, optionIndex, tiltBand, tiltBandText } from "../src/index.ts";

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

  it("asks System One one choice over the whole menu, or a tilt choice and a five-level throttle question", () => {
    for (const { questions } of Object.values(PROMPTS)) {
      if ("manoeuvre" in questions) {
        expect(questions.manoeuvre.type).toBe("choice");
        expect(Object.keys(questions.manoeuvre.criteria)).toEqual(OPTION_KEYS);
      } else {
        expect(Object.keys(questions.tilt.criteria)).toEqual(TILT_KEYS);
        expect(Object.keys(questions.throttle.criteria)).toHaveLength(5);
      }
    }
  });

  it("lists every key in the chat prompts that show the menu, and every tilt part in the rules", () => {
    for (const key of OPTION_KEYS) expect(LLM_PROMPTS.c1.system).toContain(`${key}: `);
    for (const key of TILT_KEYS) expect(LLM_PROMPTS.c3.system).toContain(`: ${key}`);
    expect(LLM_PROMPTS.c3.system.length).toBeLessThan(LLM_PROMPTS.c2.system.length / 2);
  });

  it("makes m4 and the split prompts shorter than m2", () => {
    const size = (q: object) => JSON.stringify(q).length;
    expect(size(PROMPTS.m4.questions)).toBeLessThan((size(PROMPTS.m2.questions) * 2) / 3);
    expect(size(PROMPTS.f1.questions)).toBeLessThan(size(PROMPTS.m2.questions) / 3);
  });

  it("keeps Laya's prompt well inside its 512-token context", () => {
    const { manoeuvre } = PROMPTS.m3.questions;
    const text = observePrompt(createLane(42), PROMPTS.m3) + manoeuvre.instructions + Object.entries(manoeuvre.criteria).flat().join(" ");
    // ~4 characters per English token; a generous bound.
    expect(text.length / 3).toBeLessThan(400);
  });
});
