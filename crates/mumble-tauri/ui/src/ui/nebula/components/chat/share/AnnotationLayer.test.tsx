/**
 * The annotation toolbar Nebula draws over Standard's drawing engine.
 *
 * What is worth pinning here is the seam, not the ink: that the tools appear
 * only while the channel is being annotated, that choosing a colour reaches
 * the engine holding it, and that "clear" says - and sends - something
 * different for the broadcaster than for someone drawing on their picture.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { withNebulaTheme } from "../../../testTheme";

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => undefined),
}));

import { AnnotationLayer } from "./AnnotationLayer";

const CHANNEL = 7;
const OWN = 42;

/** jsdom lays nothing out and paints nothing, and the overlay asks for both
 *  the moment it mounts. Answering "no context, no observations" is the case
 *  the component already handles - a canvas that is not on screen yet. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  invoke.mockClear();
  useAppStore.setState({
    drawingActiveChannels: new Set([CHANNEL]),
    broadcastingSessions: new Set<number>(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = () =>
  render(
    withNebulaTheme(
      <AnnotationLayer channelId={CHANNEL} ownSession={OWN} media={{ current: null }} fit="contain" />,
    ),
  );

/** The last `send_draw_stroke` payload, as the command received it. */
function lastStroke(): Record<string, unknown> {
  const call = [...invoke.mock.calls].reverse().find(([name]) => name === "send_draw_stroke");
  expect(call, "no send_draw_stroke was invoked").toBeDefined();
  return (call![1] as { args: Record<string, unknown> }).args;
}

describe("AnnotationLayer", () => {
  it("shows no tools until the channel is being annotated", () => {
    useAppStore.setState({ drawingActiveChannels: new Set() });
    mount();
    expect(screen.queryByLabelText("Stroke width")).toBeNull();
    expect(screen.queryByLabelText("Clear my drawings")).toBeNull();
  });

  it("offers the palette and the nib while it is", () => {
    mount();
    expect(screen.getByLabelText("Stroke width")).toBeTruthy();
    // Red is the default, and the only swatch that starts pressed.
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0].getAttribute("aria-label")).toBe("Select color ffff0000");
  });

  it("draws in the colour last chosen", () => {
    mount();
    fireEvent.click(screen.getByLabelText("Select color ff0088ff"));
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0].getAttribute("aria-label")).toBe("Select color ff0088ff");
  });

  it("clears only our own strokes when we are not the one sharing", () => {
    mount();
    fireEvent.click(screen.getByLabelText("Clear my drawings"));
    expect(lastStroke()).toMatchObject({ channelId: CHANNEL, isClear: true, clearAll: false });
  });

  it("clears everyone's when we are", () => {
    useAppStore.setState({ broadcastingSessions: new Set([OWN]) });
    mount();
    expect(screen.queryByLabelText("Clear my drawings")).toBeNull();
    fireEvent.click(screen.getByLabelText("Clear everyone's drawings"));
    expect(lastStroke()).toMatchObject({ channelId: CHANNEL, isClear: true, clearAll: true });
  });
});
