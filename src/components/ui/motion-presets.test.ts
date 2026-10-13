import { expect, test } from "vitest";
import {
  motionPresets,
  reducedMotionPresets,
  type MotionPresetCollection,
} from "./motion-presets";

const allowedAnimatedKeys = new Set(["opacity", "x", "y", "scale"]);

function expectTransformOnlyPreset(
  presets: MotionPresetCollection,
  name: keyof MotionPresetCollection,
) {
  const preset = presets[name];

  if ("whileHover" in preset || "whileTap" in preset) {
    for (const state of [preset.whileHover, preset.whileTap]) {
      if (!state || typeof state !== "object") {
        continue;
      }

      for (const key of Object.keys(state)) {
        expect(allowedAnimatedKeys.has(key)).toBe(true);
      }
    }

    return;
  }

  for (const state of Object.values(preset)) {
    if (!state || typeof state !== "object") {
      continue;
    }

    for (const [key] of Object.entries(state)) {
      if (key === "transition") {
        continue;
      }

      expect(allowedAnimatedKeys.has(key)).toBe(true);
    }
  }
}

test("standard motion presets animate only opacity and transforms", () => {
  expect(motionPresets.riseIn.visible).toMatchObject({ opacity: 1, y: 0 });
  expectTransformOnlyPreset(motionPresets, "riseIn");
  expectTransformOnlyPreset(motionPresets, "staggerChildren");
  expectTransformOnlyPreset(motionPresets, "messageEnter");
  expectTransformOnlyPreset(motionPresets, "statusTransition");
  expectTransformOnlyPreset(motionPresets, "cardHover");
});

test("reduced-motion presets remove spatial transforms", () => {
  expect(reducedMotionPresets.riseIn.hidden).toEqual({ opacity: 0 });
  expect(JSON.stringify(reducedMotionPresets)).not.toMatch(/"x"|"y"|"scale"/);
});
