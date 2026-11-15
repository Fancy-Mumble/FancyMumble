import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { withNebulaTheme } from "../../testTheme";
import HistoryRefusedNotice from "./HistoryRefusedNotice";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

describe("HistoryRefusedNotice", () => {
  const retryHistoryFetch = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    retryHistoryFetch.mockClear();
    useAppStore.setState({ pchatHistoryRefused: {}, retryHistoryFetch });
  });

  afterEach(cleanup);

  it("stays silent while no page of this channel was refused", () => {
    useAppStore.setState({ pchatHistoryRefused: { 9: { kind: "permission", detail: "" } } });
    const { container } = render(withNebulaTheme(<HistoryRefusedNotice channelId={4} />));
    expect(container.firstChild).toBeNull();
  });

  it("a refused page shows the notice with the server's words, and Retry re-runs the load", () => {
    useAppStore.setState({ pchatHistoryRefused: { 4: { kind: "permission", detail: "not allowed" } } });
    render(withNebulaTheme(<HistoryRefusedNotice channelId={4} />));

    expect(screen.getByTestId(TID.pchatHistoryRefused)).toBeTruthy();
    expect(screen.getByText("Couldn't load older messages")).toBeTruthy();
    expect(screen.getByText("not allowed")).toBeTruthy();

    fireEvent.click(screen.getByTestId(TID.pchatHistoryRetry));
    expect(retryHistoryFetch).toHaveBeenCalledWith(4);
  });
});
