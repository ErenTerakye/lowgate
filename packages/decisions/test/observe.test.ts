import { createLane } from "@lowgate/engine";
import { describe, expect, it } from "vitest";
import { PROMPTS, observe, observePrompt } from "../src/index.ts";

const lane = createLane(42);

describe("brief observation", () => {
  it("keeps only the lines a pilot acts on", () => {
    const keys = observe(lane, 4, { brief: true })
      .split("\n")
      .map((line) => line.split(":")[0]);
    expect(keys).toEqual(["velocity", "angle", "height above ground below", "safe horizontal speed now", "safe vertical speed now", "good tilt now"]);
  });

  it("repeats the full observation's lines word for word", () => {
    const full = observe(lane, 4).split("\n");
    for (const line of observe(lane, 4, { brief: true }).split("\n")) expect(full).toContain(line);
  });

  it("needs tier 4", () => {
    expect(() => observe(lane, 3, { brief: true })).toThrow(/tier 4/);
  });

  it("is what prompt m3 sends, and the other prompts send the full tier 4 text", () => {
    expect(observePrompt(lane, PROMPTS.m3)).toBe(observe(lane, 4, { brief: true }));
    expect(observePrompt(lane, PROMPTS.m1)).toBe(observe(lane, 4));
    expect(observePrompt(lane, PROMPTS.m2)).toBe(observe(lane, 4));
  });
});
