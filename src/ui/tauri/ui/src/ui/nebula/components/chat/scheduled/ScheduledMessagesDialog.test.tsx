import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { ScheduleStatus, type ScheduledMessage } from "@core/store/slices/scheduled";
import type { ChannelEntry } from "@core/types";
import { TID } from "@core/testids";
import { withNebulaTheme } from "../../../testTheme";
import { DEFAULT_TIME_DISPLAY } from "../../../selectors";
import { ScheduledMessagesDialog } from "./ScheduledMessagesDialog";
import { toLocalInputValue } from "./scheduledModel";

const actions = {
  scheduleMessage: vi.fn(async () => undefined),
  listScheduledMessages: vi.fn(async () => undefined),
  cancelScheduledMessage: vi.fn(async () => undefined),
};

function pending(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    scheduleId: "s1",
    channelIds: [4],
    treeIds: [],
    message: "Raid starts now",
    deliverAt: Date.now() + 3_600_000,
    status: ScheduleStatus.Pending,
    ...overrides,
  };
}

function show(overrides: Partial<Parameters<typeof ScheduledMessagesDialog>[0]> = {}) {
  const onClose = vi.fn();
  render(
    withNebulaTheme(
      <ScheduledMessagesDialog
        channelId={4}
        channelName="Raids"
        time={DEFAULT_TIME_DISPLAY}
        onClose={onClose}
        {...overrides}
      />,
    ),
  );
  return { onClose };
}

describe("ScheduledMessagesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      ...actions,
      channels: [{ id: 4, name: "Raids" }] as ChannelEntry[],
      scheduledMessages: [],
      scheduledLoading: false,
      scheduledLastAck: null,
    });
  });
  afterEach(cleanup);

  it("asks the server for the list when it opens", () => {
    show();
    expect(actions.listScheduledMessages).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(TID.scheduledEmpty).textContent).toBe("No scheduled messages.");
  });

  it("schedules the typed message into the open channel", async () => {
    show();
    const due = Date.now() + 2 * 3_600_000;
    fireEvent.change(screen.getByTestId(TID.scheduledBodyInput), { target: { value: "  Raid starts now " } });
    fireEvent.change(screen.getByTestId(TID.scheduledTimeInput), { target: { value: toLocalInputValue(due) } });
    fireEvent.click(screen.getByTestId(TID.scheduledSubmit));

    await waitFor(() => expect(actions.scheduleMessage).toHaveBeenCalled());
    const [channelIds, text, deliverAt] = actions.scheduleMessage.mock.calls[0] as unknown as [number[], string, number];
    expect(channelIds).toEqual([4]);
    expect(text).toBe("Raid starts now");
    expect(Math.abs(deliverAt - due)).toBeLessThan(60_000);
    await waitFor(() => expect((screen.getByTestId(TID.scheduledBodyInput) as HTMLTextAreaElement).value).toBe(""));
  });

  it("refuses a time in the past without asking the server", () => {
    show();
    fireEvent.change(screen.getByTestId(TID.scheduledBodyInput), { target: { value: "too late" } });
    fireEvent.change(screen.getByTestId(TID.scheduledTimeInput), {
      target: { value: toLocalInputValue(Date.now() - 5 * 60_000) },
    });
    fireEvent.click(screen.getByTestId(TID.scheduledSubmit));
    expect(screen.getByTestId(TID.scheduledError).textContent).toBe("The delivery time must be in the future.");
    expect(actions.scheduleMessage).not.toHaveBeenCalled();
  });

  it("lists only the pending ones, and cancels one", () => {
    useAppStore.setState({
      scheduledMessages: [
        pending(),
        pending({ scheduleId: "s2", message: "already sent", status: ScheduleStatus.Delivered }),
      ],
    });
    show();
    const rows = screen.getAllByTestId(TID.scheduledItem);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Raid starts now");
    expect(rows[0].textContent).toContain("Raids");
    fireEvent.click(within(rows[0]).getByTestId(TID.scheduledItemCancel));
    expect(actions.cancelScheduledMessage).toHaveBeenCalledWith("s1");
  });

  it("shows the server's reason for a rejection", () => {
    useAppStore.setState({
      scheduledLastAck: { status: ScheduleStatus.Rejected, reason: "Too many scheduled messages" },
    });
    show();
    expect(screen.getByTestId(TID.scheduledError).textContent).toBe("Too many scheduled messages");
  });

  it("warns that an encrypted channel's scheduled message is not encrypted", () => {
    show();
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    show({ encrypted: true });
    expect(screen.getByRole("note")).toBeTruthy();
  });
});
