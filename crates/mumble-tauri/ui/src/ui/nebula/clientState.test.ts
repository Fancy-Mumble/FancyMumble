import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFirstUnreadId } from "./clientState";

function messages(...ids: string[]) {
  return ids.map((message_id) => ({ message_id }));
}

describe("useFirstUnreadId", () => {
  it("has nothing to mark when everything is read", () => {
    const { result } = renderHook(() => useFirstUnreadId(messages("a", "b", "c"), "chan:1", 0));
    expect(result.current).toBeNull();
  });

  it("marks the first of the unread tail", () => {
    const { result } = renderHook(() => useFirstUnreadId(messages("a", "b", "c", "d"), "chan:1", 2));
    expect(result.current).toBe("c");
  });

  it("clamps to the top when the whole conversation is new", () => {
    const { result } = renderHook(() => useFirstUnreadId(messages("a", "b"), "chan:1", 9));
    expect(result.current).toBe("a");
  });

  it("holds its place while the conversation is read", () => {
    const { result, rerender } = renderHook(
      ({ list, unread }: { list: { message_id: string }[]; unread: number }) =>
        useFirstUnreadId(list, "chan:1", unread),
      { initialProps: { list: messages("a", "b", "c", "d"), unread: 2 } },
    );
    expect(result.current).toBe("c");

    // Reading the channel zeroes the store's count. The rule must not follow
    // it - it marks where reading *started*, not where it is now.
    rerender({ list: messages("a", "b", "c", "d"), unread: 0 });
    expect(result.current).toBe("c");
  });

  it("re-snapshots on the next conversation", () => {
    const { result, rerender } = renderHook(
      ({ key, unread }: { key: string; unread: number }) =>
        useFirstUnreadId(messages("a", "b", "c", "d"), key, unread),
      { initialProps: { key: "chan:1", unread: 2 } },
    );
    expect(result.current).toBe("c");

    rerender({ key: "chan:2", unread: 1 });
    expect(result.current).toBe("d");
  });
});
