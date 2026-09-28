import { describe, expect, it } from "vitest";
import { ScheduleStatus, type ScheduledMessage } from "@core/store/slices/scheduled";
import type { ChannelEntry } from "@core/types";
import { DEFAULT_TIME_DISPLAY } from "../../../selectors";
import {
  checkDelivery,
  deliveryLabel,
  pendingScheduled,
  scheduledTargets,
  toLocalInputValue,
} from "./scheduledModel";

function scheduled(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    scheduleId: "s1",
    channelIds: [4],
    treeIds: [],
    message: "Raid starts now",
    deliverAt: Date.now() + 60_000,
    status: ScheduleStatus.Pending,
    ...overrides,
  };
}

describe("scheduledModel", () => {
  it("writes a datetime-local value that reads back as the same minute", () => {
    const at = new Date(2026, 8, 13, 9, 5, 42).getTime();
    expect(toLocalInputValue(at)).toBe("2026-09-13T09:05");
    expect(new Date(toLocalInputValue(at)).getTime()).toBe(new Date(2026, 8, 13, 9, 5).getTime());
  });

  it("accepts a future time and refuses a past or empty one", () => {
    const now = new Date(2026, 8, 13, 12, 0).getTime();
    expect(checkDelivery("2026-09-13T12:30", now)).toEqual({
      ok: true,
      deliverAt: new Date(2026, 8, 13, 12, 30).getTime(),
    });
    expect(checkDelivery("2026-09-13T11:59", now)).toEqual({ ok: false, reason: "past" });
    expect(checkDelivery("2026-09-13T12:00", now)).toEqual({ ok: false, reason: "past" });
    expect(checkDelivery("", now)).toEqual({ ok: false, reason: "invalid" });
    expect(checkDelivery("not a date", now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps only what is still waiting, soonest first", () => {
    const list = pendingScheduled([
      scheduled({ scheduleId: "late", deliverAt: 3000 }),
      scheduled({ scheduleId: "done", deliverAt: 1000, status: ScheduleStatus.Delivered }),
      scheduled({ scheduleId: "gone", deliverAt: 1000, status: ScheduleStatus.Cancelled }),
      scheduled({ scheduleId: "soon", deliverAt: 2000 }),
      scheduled({ scheduleId: "undated", deliverAt: undefined }),
    ]);
    expect(list.map((message) => message.scheduleId)).toEqual(["soon", "late", "undated"]);
  });

  it("names the target channels, falling back to the id for one that has gone", () => {
    const channels = [{ id: 4, name: "Raids" }] as ChannelEntry[];
    expect(scheduledTargets(scheduled({ channelIds: [4], treeIds: [9] }), channels)).toBe("Raids, #9");
  });

  it("gives a clock for today and a date as well for any other day", () => {
    const now = new Date(2026, 8, 13, 9, 0).getTime();
    const display = { ...DEFAULT_TIME_DISPLAY, timeFormat: "24h" as const };
    expect(deliveryLabel(new Date(2026, 8, 13, 14, 5).getTime(), display, now)).toBe("14:05");
    const nextWeek = deliveryLabel(new Date(2026, 8, 20, 14, 5).getTime(), display, now);
    expect(nextWeek).toContain("14:05");
    expect(nextWeek).not.toBe("14:05");
    expect(deliveryLabel(undefined, display, now)).toBe("");
  });
});
