import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { alpha } from "@mui/material/styles";
import { TID } from "@core/testids";
import type { SavedServer } from "@core/types";
import type { ServerLivery } from "../../livery";
import { serverTint } from "../../selectors";
import { withNebulaTheme } from "../../testTheme";
import { ADDRESS_CHIP, ConnectScreen } from "./ConnectScreen";
import { contrast } from "../../livery";

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

/**
 * A page with no branding on it has several possible causes and, without this,
 * exactly one appearance. The dot names which one.
 */
describe("ConnectScreen livery indicator", () => {
  const online = {
    online: true,
    latency_ms: 20,
    user_count: 4,
    max_user_count: 101,
    server_version: "1.6.0",
  };

  async function statusOf(): Promise<string | null> {
    const dot = await screen.findByTestId(TID.connectLiveryStatus);
    return dot.getAttribute("data-livery-status");
  }

  it("says the branding is live when it came from an open connection", async () => {
    invokeMock.mockResolvedValue({ ...online, livery_digest: "aaaa" } as never);
    renderConnect({ version: 1, digest: "aaaa", tagline: "live", tags: [], palette: {} });
    await waitFor(async () => expect(await statusOf()).toBe("live"));
  });

  it("fetches branding this client has not held, without joining the server", async () => {
    // A livery is readable the way the user count is - by asking. Nothing here
    // waits for the user to connect first.
    invokeMock.mockImplementation((command: string) => {
      if (command === "ping_server") return Promise.resolve({ ...online, livery_digest: "aaaa" });
      if (command === "probe_livery") return new Promise(() => undefined); // still out
      return Promise.resolve({});
    });
    renderConnect();
    await waitFor(async () => expect(await statusOf()).toBe("fetching"));
    expect(invokeMock).toHaveBeenCalledWith("probe_livery", { host: "localhost", port: 64738 });
  });

  it("draws what the fetch came back with instead of loading for ever", async () => {
    // Regression: recording the attempt flips `resolved.fetch` false, which
    // re-runs the fetching effect. When that effect cancelled itself on
    // cleanup, the answer arrived to a listener that had already given up and
    // the dot pulsed "loading" until the page was left.
    invokeMock.mockImplementation((command: string) => {
      if (command === "ping_server") return Promise.resolve({ ...online, livery_digest: "aaaa" });
      if (command === "probe_livery")
        return Promise.resolve({
          version: 3,
          digest: "aaaa",
          tagline: "fetched without joining",
          tags: [],
          palette: {},
        });
      return Promise.resolve({});
    });
    renderConnect();
    await waitFor(() => expect(screen.getByText("fetched without joining")).toBeTruthy());
    expect(await statusOf()).toBe("cached");
  });

  it("asks only once for the same document", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "ping_server") return Promise.resolve({ ...online, livery_digest: "aaaa" });
      if (command === "probe_livery")
        return Promise.resolve({ version: 3, digest: "aaaa", tags: [], palette: {} });
      return Promise.resolve({});
    });
    // Calls accumulate across this file; only this render's are the subject.
    invokeMock.mockClear();
    renderConnect();
    await waitFor(async () => expect(await statusOf()).toBe("cached"));
    const asks = invokeMock.mock.calls.filter(([command]) => command === "probe_livery");
    expect(asks).toHaveLength(1);
  });

  it("says so when the branding could not be fetched", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "ping_server") return Promise.resolve({ ...online, livery_digest: "aaaa" });
      if (command === "probe_livery") return Promise.reject(new Error("refused"));
      return Promise.resolve({});
    });
    renderConnect();
    await waitFor(async () => expect(await statusOf()).toBe("failed"));
  });

  it("distinguishes a server with no branding from one that cannot say", async () => {
    invokeMock.mockResolvedValue({ ...online, livery_digest: "" } as never);
    const none = renderConnect();
    await waitFor(async () => expect(await statusOf()).toBe("absent"));
    none.unmount();

    invokeMock.mockResolvedValue({ ...online, livery_digest: null } as never);
    renderConnect();
    await waitFor(async () => expect(await statusOf()).toBe("unverified"));
  });

  it("says so when the server could not be reached to ask", async () => {
    invokeMock.mockResolvedValue({
      online: false,
      latency_ms: null,
      user_count: null,
      max_user_count: null,
      server_version: null,
    } as never);
    renderConnect();
    await waitFor(async () => expect(await statusOf()).toBe("unreachable"));
  });
});

/**
 * The address chip is the one thing on this page a server cannot restyle, and
 * the reason the name above it can safely be the operator's chosen one. That
 * guarantee is worth nothing if the chip itself is unreadable, and what sits
 * behind it is a picture the server picked - so the floor has to hold against
 * the worst banner rather than against the one in front of us.
 */
describe("the address chip stays readable over any banner", () => {
  /** `over` seen through the chip's scrim, as the compositor would blend it. */
  function throughScrim(over: readonly [number, number, number]): [number, number, number] {
    const { scrim, scrimAlpha } = ADDRESS_CHIP;
    return over.map((channel, at) => Math.round(scrim[at] * scrimAlpha + channel * (1 - scrimAlpha))) as [
      number,
      number,
      number,
    ];
  }

  /** The chip's ink over that composite. */
  function ink(ground: readonly [number, number, number]): [number, number, number] {
    const { ink: colour, inkAlpha } = ADDRESS_CHIP;
    return ground.map((channel, at) => Math.round(colour[at] * inkAlpha + channel * (1 - inkAlpha))) as [
      number,
      number,
      number,
    ];
  }

  // WCAG 2.1 AA for body text. The chip is small, so this is the floor that
  // applies - not the 3:1 one large text gets.
  const FLOOR = 4.5;

  it.each([
    ["a white banner", [255, 255, 255]],
    ["a black banner", [0, 0, 0]],
    ["a bright bokeh banner", [214, 226, 240]],
    ["a saturated banner", [255, 214, 0]],
  ])("clears AA on %s", (_what, banner) => {
    const ground = throughScrim(banner as [number, number, number]);
    expect(contrast(ink(ground), ground)).toBeGreaterThanOrEqual(FLOOR);
  });
});

describe("ConnectScreen identity order", () => {
  const SECOND: SavedServer = { ...SERVER, id: "s2", username: "Zewi" };

  function renderIdentities(
    identities: readonly SavedServer[],
    onReorderIdentities?: (ids: readonly string[]) => void,
  ) {
    invokeMock.mockResolvedValue({ online: false } as never);
    return render(
      withNebulaTheme(
        <ConnectScreen
          server={SERVER}
          identities={identities}
          connecting={false}
          error={null}
          onConnect={vi.fn()}
          onAddIdentity={vi.fn()}
          onReorderIdentities={onReorderIdentities}
        />,
      ),
    );
  }

  it("gives every row a grip when there is an order to change", () => {
    renderIdentities([SERVER, SECOND], vi.fn());
    expect(screen.getAllByTestId(TID.connectIdentityHandle)).toHaveLength(2);
  });

  it("draws no grip on a lone identity", () => {
    // One row is an order already, and the grip's column would push the row's
    // contents across for a gesture that could not do anything.
    renderIdentities([SERVER], vi.fn());
    expect(screen.queryByTestId(TID.connectIdentityHandle)).toBeNull();
  });

  it("draws no grip when nobody is there to remember the arrangement", () => {
    renderIdentities([SERVER, SECOND]);
    expect(screen.queryByTestId(TID.connectIdentityHandle)).toBeNull();
  });

  it("moves an identity with the arrow keys, for a pointer nobody is holding", () => {
    const onReorder = vi.fn();
    renderIdentities([SERVER, SECOND], onReorder);

    const grips = screen.getAllByTestId(TID.connectIdentityHandle);
    fireEvent.keyDown(grips[1], { key: "ArrowUp" });
    expect(onReorder).toHaveBeenCalledWith(["s2", "s1"]);

    onReorder.mockClear();
    fireEvent.keyDown(grips[0], { key: "ArrowDown" });
    expect(onReorder).toHaveBeenCalledWith(["s2", "s1"]);
  });

  it("stays put at the ends of the list", () => {
    const onReorder = vi.fn();
    renderIdentities([SERVER, SECOND], onReorder);

    const grips = screen.getAllByTestId(TID.connectIdentityHandle);
    fireEvent.keyDown(grips[0], { key: "ArrowUp" });
    fireEvent.keyDown(grips[1], { key: "ArrowDown" });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does not pick the identity whose grip was clicked", async () => {
    // Picking a row up is not the same as picking it: the connect button must
    // still name whoever was selected before the drag started.
    renderIdentities([SERVER, SECOND], vi.fn());
    await waitFor(() => expect(screen.getByText("Connect as MumbleUser")).toBeTruthy());

    fireEvent.click(screen.getAllByTestId(TID.connectIdentityHandle)[1]);
    expect(screen.getByText("Connect as MumbleUser")).toBeTruthy();

    // The row around it still picks, or the guard above would be proving
    // nothing more than that the click never landed.
    fireEvent.click(screen.getByText("Zewi"));
    expect(screen.getByText("Connect as Zewi")).toBeTruthy();
  });
});
