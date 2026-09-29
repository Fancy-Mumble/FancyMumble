/**
 * A menu is a popover at the pointer on a window and a sheet from the bottom
 * edge on a phone - and the same items, doing the same things, either way.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuItem } from "@mui/material";
import { withNebulaTheme } from "../../testTheme";
import { HANDHELD_ATTR } from "../../useIsHandheld";
import { Menu } from "./Menu";

function draw(onClose = vi.fn(), onPick = vi.fn()) {
  render(
    withNebulaTheme(
      <Menu
        open
        onClose={onClose}
        anchorReference="anchorPosition"
        anchorPosition={{ top: 40, left: 40 }}
        slotProps={{ paper: { sx: { width: 224 } } }}
      >
        <MenuItem onClick={onPick}>Reply</MenuItem>
      </Menu>,
    ),
  );
  return { onClose, onPick };
}

function paper(): HTMLElement {
  return screen.getByRole("menu").closest(".MuiPaper-root") as HTMLElement;
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(HANDHELD_ATTR);
});

describe("Menu", () => {
  it("is a popover on a window", () => {
    document.documentElement.setAttribute(HANDHELD_ATTR, "off");
    draw();
    expect(paper().hasAttribute("data-nebula-sheet")).toBe(false);
  });

  it("is a sheet on a phone, and its rows still work", () => {
    document.documentElement.setAttribute(HANDHELD_ATTR, "on");
    const { onPick } = draw();
    expect(paper().hasAttribute("data-nebula-sheet")).toBe(true);
    fireEvent.click(screen.getByText("Reply"));
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("dims the page behind the sheet, and a tap there puts it away", () => {
    document.documentElement.setAttribute(HANDHELD_ATTR, "on");
    const { onClose } = draw();
    const backdrop = document.querySelector(".MuiBackdrop-root") as HTMLElement;
    expect(backdrop.classList.contains("MuiBackdrop-invisible")).toBe(false);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledWith(expect.anything(), "backdropClick");
  });

  it("goes away when pulled down", () => {
    document.documentElement.setAttribute(HANDHELD_ATTR, "on");
    const { onClose } = draw();
    const sheet = paper();
    const at = (y: number) => [{ clientX: 100, clientY: y }];
    act(() => {
      fireEvent.touchStart(sheet, { touches: at(300) });
      fireEvent.touchMove(sheet, { touches: at(320) });
      fireEvent.touchMove(sheet, { touches: at(450) });
      fireEvent.touchEnd(sheet, { changedTouches: at(450) });
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
