import { describe, expect, it } from "vitest";
import {
  MAX_TRAINEES,
  codeMatches,
  pickFreeSlot,
  traineeEmail,
  traineeSlot,
  trainingEnabled,
} from "@/lib/training-access";

describe("trainingEnabled", () => {
  it("is on when the mode is set and a code is configured", () => {
    expect(
      trainingEnabled({ TRAINING_MODE: "1", TRAINING_ACCESS_CODE: "reef-2026" }),
    ).toBe(true);
  });

  it("is off unless the mode is switched on", () => {
    expect(trainingEnabled({ TRAINING_ACCESS_CODE: "reef-2026" })).toBe(false);
    expect(
      trainingEnabled({ TRAINING_MODE: "0", TRAINING_ACCESS_CODE: "reef-2026" }),
    ).toBe(false);
  });

  it("is off when the code is blank, so the mode alone opens nothing", () => {
    expect(trainingEnabled({ TRAINING_MODE: "1" })).toBe(false);
    expect(trainingEnabled({ TRAINING_MODE: "1", TRAINING_ACCESS_CODE: "  " })).toBe(
      false,
    );
  });
});

describe("codeMatches", () => {
  it("accepts the configured code", () => {
    expect(codeMatches("reef-2026", "reef-2026")).toBe(true);
  });

  it("rejects a wrong code, whatever its length", () => {
    expect(codeMatches("reef-2025", "reef-2026")).toBe(false);
    expect(codeMatches("reef", "reef-2026")).toBe(false);
    expect(codeMatches("reef-2026-and-more", "reef-2026")).toBe(false);
  });

  it("rejects everything when no code is configured", () => {
    expect(codeMatches("", undefined)).toBe(false);
    expect(codeMatches("anything", "")).toBe(false);
  });
});

describe("trainee addresses", () => {
  it("pads the slot so the addresses sort and read consistently", () => {
    expect(traineeEmail(7)).toBe("trainee-07@training.sdmxsurfer.net");
    expect(traineeEmail(112)).toBe("trainee-112@training.sdmxsurfer.net");
  });

  it("reads the slot back out of the address", () => {
    expect(traineeSlot(traineeEmail(7))).toBe(7);
    expect(traineeSlot(traineeEmail(112))).toBe(112);
  });

  it("does not claim addresses that belong to real users", () => {
    expect(traineeSlot("someone@spc.int")).toBeNull();
    expect(traineeSlot("trainee-07@spc.int")).toBeNull();
    expect(traineeSlot("person@training.sdmxsurfer.net")).toBeNull();
  });
});

describe("pickFreeSlot", () => {
  it("skips slots that are already taken", () => {
    expect(pickFreeSlot([1, 2, 3], () => 0)).toBe(4);
  });

  it("can still find the one slot left", () => {
    const taken = Array.from({ length: MAX_TRAINEES }, (_, i) => i + 1).filter(
      (n) => n !== 42,
    );
    expect(pickFreeSlot(taken, () => 0)).toBe(42);
  });

  it("returns null once the pool is full, so a leaked code mints nothing", () => {
    const taken = Array.from({ length: MAX_TRAINEES }, (_, i) => i + 1);
    expect(pickFreeSlot(taken, () => 0)).toBeNull();
  });
});
