/**
 * The Account page, from the question it asks on open to the proof it sends.
 *
 * The page had no test and sat on "Loading account information…" for ever on
 * every server, because the query it sends had no canon form and the codec
 * dropped it. What is checked here is the client half of that: the query goes
 * out, a snapshot renders, and every change carries the password the server
 * refuses to act without.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));

import { useAccountStore } from "@core/features/settings/accountStore";
import type { AccountSettings as Snapshot } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { AccountSettings } from "./AccountSettings";

const REGISTERED: Snapshot = {
  registered: true,
  user_id: 7,
  name: "ada",
  email: "ada@example.org",
  has_password: true,
  totp_enabled: false,
  cert_hash: "deadbeef",
  cert_matches_session: true,
};

/** The arguments of the last `update_account_settings` call. */
function lastUpdate() {
  const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === "update_account_settings");
  return calls.at(-1)?.[1] as
    | { action: string; value: string | null; currentPassword: string | null }
    | undefined;
}

async function renderPage(snapshot: Snapshot = REGISTERED) {
  const view = render(withNebulaTheme(<AccountSettings />));
  useAccountStore.getState().setSnapshot(snapshot);
  await screen.findByLabelText("Current password");
  return view;
}

describe("AccountSettings", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    useAccountStore.getState().clear();
  });

  it("asks the server about the account as soon as it opens", async () => {
    render(withNebulaTheme(<AccountSettings />));
    // Nothing has answered yet, so this is the state the bug froze in.
    expect(screen.getByText(/loading/i)).toBeTruthy();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "update_account_settings",
        expect.objectContaining({ action: "query" }),
      ),
    );
  });

  it("renders the account once the server answers", async () => {
    await renderPage();
    expect(screen.getByText(/ada/)).toBeTruthy();
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  it("refuses to send a change until the current password is given", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("Repeat password"), { target: { value: "hunter2hunter2" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "hunter2hunter2" } });

    // Valid new password, no proof: the server would refuse it, so the page
    // does not spend a round trip finding that out.
    expect(screen.getByRole("button", { name: /change password/i })).toHaveProperty("disabled", true);
  });

  it("carries the current password with the change", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "correct horse" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "hunter2hunter2" } });
    fireEvent.change(screen.getByLabelText("Repeat password"), { target: { value: "hunter2hunter2" } });

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    await waitFor(() =>
      expect(lastUpdate()).toMatchObject({
        action: "set_password",
        value: "hunter2hunter2",
        currentPassword: "correct horse",
      }),
    );
  });

  it("stops waiting on the initial query if the server never answers", async () => {
    vi.useFakeTimers();
    try {
      render(withNebulaTheme(<AccountSettings />));
      // Flush the mocked invoke() promise so the reply timer starts.
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByText(/loading/i)).toBeTruthy();

      // No account-settings event ever arrives (dropped by the codec, or a
      // server too old to answer) - this is the bug the page shipped with.
      await act(() => vi.advanceTimersByTimeAsync(8000));
      expect(screen.queryByText(/loading/i)).toBeNull();
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting on a change if the server never acks it", async () => {
    vi.useFakeTimers();
    try {
      render(withNebulaTheme(<AccountSettings />));
      act(() => useAccountStore.getState().setSnapshot(REGISTERED));

      fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "correct horse" } });
      fireEvent.change(screen.getByLabelText("New password"), { target: { value: "hunter2hunter2" } });
      fireEvent.change(screen.getByLabelText("Repeat password"), { target: { value: "hunter2hunter2" } });

      fireEvent.click(screen.getByRole("button", { name: /change password/i }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByRole("button", { name: /change password/i })).toHaveProperty("disabled", true);

      // No account-ack ever arrives - the button must not stay disabled forever.
      await act(() => vi.advanceTimersByTimeAsync(8000));
      expect(screen.getByRole("button", { name: /change password/i })).toHaveProperty("disabled", false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks a certificate-only account for no password at all", async () => {
    // It has none to prove, and the certificate it connected with is the proof
    // the server accepts - asking would lock it out of the one action that
    // gives it a password.
    render(withNebulaTheme(<AccountSettings />));
    useAccountStore.getState().setSnapshot({ ...REGISTERED, has_password: false });

    await screen.findByLabelText("New password");
    expect(screen.queryByLabelText("Current password")).toBeNull();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "hunter2hunter2" } });
    fireEvent.change(screen.getByLabelText("Repeat password"), { target: { value: "hunter2hunter2" } });
    expect(screen.getByRole("button", { name: /enable password/i })).toHaveProperty("disabled", false);
  });
});
