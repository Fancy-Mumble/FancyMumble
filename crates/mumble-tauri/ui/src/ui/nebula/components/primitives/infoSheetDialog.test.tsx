import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { HANDHELD_ATTR } from "../../useIsHandheld";
import { useInfoSheetDialogProps } from "./infoSheetDialog";

describe("useInfoSheetDialogProps", () => {
  afterEach(() => document.documentElement.removeAttribute(HANDHELD_ATTR));

  it("floats the sheet as a card on a desktop", () => {
    document.documentElement.setAttribute(HANDHELD_ATTR, "off");
    const { result } = renderHook(() => useInfoSheetDialogProps());
    expect(result.current.fullScreen).toBe(false);
  });

  it("gives the sheet the whole screen on a handheld", () => {
    document.documentElement.setAttribute(HANDHELD_ATTR, "on");
    const { result } = renderHook(() => useInfoSheetDialogProps());
    expect(result.current.fullScreen).toBe(true);
  });
});
