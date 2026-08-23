import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { alpha } from "@mui/material/styles";
import type { SavedServer } from "@core/types";
import type { ServerLivery } from "../../livery";
import { serverTint } from "../../selectors";
import { withNebulaTheme } from "../../testTheme";
import { ConnectScreen } from "./ConnectScreen";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@core/preferencesStorage", () => ({
  getPreferences: vi.fn().mockResolvedValue({}),
  updatePreferences: vi.fn().mockResolvedValue({}),
}));

const SERVER: SavedServer = {
  id: "s1",
  label: "",
  host: "localhost",
  port: 64738,
  username: "MumbleUser",
  cert_label: null,
};

function renderConnect(livery: ServerLivery | null = null) {
  return render(
    withNebulaTheme(
      <ConnectScreen
        server={SERVER}
        livery={livery}
        identities={[SERVER]}
        connecting={false}
        error={null}
        onConnect={vi.fn()}
        onAddIdentity={vi.fn()}
      />,
    ),
  );
}

describe("ConnectScreen", () => {
  it("draws an unbranded server's banner in the colour assigned to its address", () => {
    invokeMock.mockResolvedValue({ online: false } as never);
    const { container } = renderConnect();

    // The name twice: once as the banner's artwork, once as the heading.
    expect(screen.getAllByText("localhost")).toHaveLength(2);

    const banner = container.querySelector("[data-nebula-banner]");
    const { from, to } = serverTint("localhost:64738");
    const painted = globalThis.getComputedStyle(banner as Element).backgroundImage;
    // jsdom normalises the stops to rgba(), which is the form `alpha` emits.
    expect(painted).toContain(alpha(from, 0.35));
    expect(painted).toContain(alpha(to, 0.35));
  });

  it("renders a server's banner and mark in place of the generated ones", () => {
    invokeMock.mockResolvedValue({ online: false } as never);
    const { container } = renderConnect({
      version: 1,
      tags: [],
      palette: {},
      bannerSrc: "blob:banner",
      iconSrc: "blob:icon",
      bannerFocus: { x: 30, y: 70 },
    });

    const banner = container.querySelector("img[src='blob:banner']");
    expect(banner).toBeTruthy();
    expect(globalThis.getComputedStyle(banner as Element).objectPosition).toBe("30% 70%");
    expect(container.querySelector("img[src='blob:icon']")).toBeTruthy();
    // The huge-name artwork is the *fallback*, so it goes when real artwork
    // arrives: the heading keeps it and the banner does not.
    expect(screen.getAllByText("localhost")).toHaveLength(1);
  });

  it("shows only the fields a server actually sent", () => {
    // The mock's middle rung. Nothing here tests "is this server branded";
    // each field renders itself or nothing.
    invokeMock.mockResolvedValue({ online: false } as never);
    renderConnect({ version: 1, tags: [], palette: {}, tagline: "Cozy corner" });

    expect(screen.getByText("Cozy corner")).toBeTruthy();
    expect(screen.queryByText(/Movie night/)).toBeNull();
  });

  it("renders a motto as text, never as markup", () => {
    invokeMock.mockResolvedValue({ online: false } as never);
    const { container } = renderConnect({
      version: 1,
      tags: [],
      palette: {},
      motd: "<img src=x onerror=alert(1)> Movie night at 21:00",
    });

    expect(screen.getByText(/Movie night at 21:00/)).toBeTruthy();
    // React escapes it; the assertion is that nobody later swaps in
    // dangerouslySetInnerHTML to make the motto "richer".
    expect(container.querySelector("img[src='x']")).toBeNull();
  });

  it("gives an operator's name to the heading and never to the address", () => {
    // The address is the one thing on this screen a server cannot forge, which
    // is what makes honouring display_name before authentication safe at all.
    invokeMock.mockResolvedValue({ online: false } as never);
    renderConnect({ version: 1, tags: [], palette: {}, displayName: "magical.rocks" });

    // Twice: the heading, and the fallback banner artwork, which is also the
    // name. The address chip keeps the host regardless.
    expect(screen.getAllByText("magical.rocks")).toHaveLength(2);
    expect(screen.getByText("mumble://localhost:64738")).toBeTruthy();
    expect(screen.queryByText("localhost")).toBeNull();
  });

  it("draws a server's chips beside the ones the client measured", () => {
    invokeMock.mockResolvedValue({ online: false } as never);
    renderConnect({
      version: 1,
      palette: {},
      tags: [{ label: "Server rules", tone: "ACCENT", href: "https://example.org/rules" }],
    });

    const link = screen.getByText("Server rules");
    expect(link.getAttribute("href")).toBe("https://example.org/rules");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("reports a server that does not answer the ping as offline", async () => {
    invokeMock.mockResolvedValue({
      online: false,
      latency_ms: null,
      user_count: null,
      max_user_count: null,
      server_version: null,
    } as never);
    renderConnect();
    await waitFor(() => expect(screen.getByText("offline")).toBeTruthy());
  });
});
