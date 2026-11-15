import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@mui/material";

const unregister = vi.fn();
const register = vi.fn((_handler: () => void) => Promise.resolve({ unregister }));
vi.mock("@tauri-apps/api/app", () => ({ onBackButtonPress: (handler: () => void) => register(handler) }));
vi.mock("@core/utils/platform", () => ({ isMobile: true }));

const { canStepBack, handleBack, useBackStep } = await import("./backGesture");

function Step({ onBack }: Readonly<{ onBack: (() => void) | null }>) {
  useBackStep(onBack);
  return null;
}

/** Let the registration promise and the observers settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  register.mockClear();
  unregister.mockClear();
});
afterEach(cleanup);

describe("the back gesture", () => {
  it("runs the newest step, not the first", async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <Step onBack={first} />
        <Step onBack={second} />
      </>,
    );
    await settle();
    handleBack();
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("holds a listener only while something can step back", async () => {
    // At the root nothing may listen, or Android's own answer - leaving the
    // app - never happens.
    const { rerender } = render(<Step onBack={() => {}} />);
    await settle();
    expect(register).toHaveBeenCalledOnce();
    expect(canStepBack()).toBe(true);

    rerender(<Step onBack={null} />);
    await settle();
    expect(unregister).toHaveBeenCalledOnce();
    expect(canStepBack()).toBe(false);
  });

  it("closes an open dialog before stepping back anywhere", async () => {
    const step = vi.fn();
    const onClose = vi.fn();
    render(
      <>
        <Step onBack={step} />
        <Dialog open onClose={onClose}>
          <div>Channel info</div>
        </Dialog>
      </>,
    );
    await settle();
    handleBack();
    expect(onClose).toHaveBeenCalledWith(expect.anything(), "escapeKeyDown");
    expect(step).not.toHaveBeenCalled();
  });

  it("listens for a dialog even at the root", async () => {
    render(
      <>
        <Step onBack={null} />
        <Dialog open onClose={() => {}}>
          <div>Add a server</div>
        </Dialog>
      </>,
    );
    await settle();
    expect(canStepBack()).toBe(true);
    expect(register).toHaveBeenCalled();
  });
});
