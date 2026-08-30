import { afterEach, describe, expect, it } from "vitest";
import {
  STAGE_HEIGHT_DEFAULT,
  STAGE_HEIGHT_MIN,
  clampStageHeight,
  readStageHeight,
  writeStageHeight,
} from "./stageHeight";

describe("clampStageHeight", () => {
  it("keeps the height between the floor and the room the column has", () => {
    expect(clampStageHeight(40, 600)).toBe(STAGE_HEIGHT_MIN);
    expect(clampStageHeight(900, 600)).toBe(600);
    expect(clampStageHeight(400.6, 600)).toBe(401);
  });

  it("never lets a cramped column push the ceiling under the floor", () => {
    expect(clampStageHeight(400, 90)).toBe(STAGE_HEIGHT_MIN);
  });
});

describe("stage height storage", () => {
  afterEach(() => localStorage.clear());

  it("defaults when nothing was stored or the value is garbage", () => {
    expect(readStageHeight()).toBe(STAGE_HEIGHT_DEFAULT);
    localStorage.setItem("fancy.nebula.stageHeight", "tall");
    expect(readStageHeight()).toBe(STAGE_HEIGHT_DEFAULT);
  });

  it("round-trips, clamping a hand-edited value to the floor", () => {
    writeStageHeight(420);
    expect(readStageHeight()).toBe(420);
    localStorage.setItem("fancy.nebula.stageHeight", "12");
    expect(readStageHeight()).toBe(STAGE_HEIGHT_MIN);
  });

  it("forgets the key again at the default so a reset leaves no residue", () => {
    writeStageHeight(420);
    writeStageHeight(STAGE_HEIGHT_DEFAULT);
    expect(localStorage.getItem("fancy.nebula.stageHeight")).toBeNull();
  });
});
