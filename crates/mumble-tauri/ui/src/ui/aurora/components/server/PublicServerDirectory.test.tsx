import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PublicServerDirectory from "./PublicServerDirectory";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("PublicServerDirectory", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) =>
      command === "fetch_public_servers"
        ? Promise.resolve([
            {
              name: "Berlin Voice",
              country: "Germany",
              country_code: "DE",
              region: "Berlin",
              ip: "voice.example",
              port: 64738,
              url: "",
            },
          ])
        : Promise.resolve({
            online: true,
            latency_ms: 18,
            user_count: 12,
            max_user_count: 100,
            server_version: "1.5",
          }),
    );
  });

  it("waits for consent, then filters and connects with a display name", async () => {
    const onConnect = vi.fn();
    render(<PublicServerDirectory username="" onUsernameChange={vi.fn()} onConnect={onConnect} />);
    expect(invokeMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load public directory" }));
    expect(await screen.findByText("Berlin Voice")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("fetch_public_servers");
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
