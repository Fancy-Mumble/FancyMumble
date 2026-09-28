import { describe, expect, it } from "vitest";
import { pickSynced, serverKey, serversToAdd, serversToPublish, type SyncedServer } from "./accountSync";

const server = (host: string, username = "ada"): SyncedServer => ({
  host,
  port: 64738,
  username,
  label: host,
});

describe("pickSynced", () => {
  it("shares preferences about the person and none about the machine", () => {
    const picked = pickSynced({
      timeFormat: "24h",
      disableReadReceipts: true,
      uiDesign: "nebula",
      logLevel: "debug",
      streamerMode: true,
    } as never);
    expect(picked).toEqual({ timeFormat: "24h", disableReadReceipts: true });
  });
});

describe("serversToAdd", () => {
  it("adds what is new here, and not what is saved or was removed here", () => {
    const remote = [server("a.example"), server("b.example"), server("c.example"), server("a.example")];
    const local = [{ host: "A.Example", port: 64738, username: "ADA" }];
    const seen = [serverKey(server("c.example"))];
    expect(serversToAdd(remote, local, seen)).toEqual([server("b.example")]);
  });
});

describe("serversToPublish", () => {
  it("writes only when this device has something the record lacks", () => {
    const remote = [server("a.example")];
    // A different label or password is not a reason to write; two devices
    // would otherwise overwrite each other for ever.
    expect(serversToPublish(remote, [{ ...server("a.example"), label: "Mine", password: "x" }])).toBeNull();
    expect(serversToPublish(remote, [server("b.example")])).toEqual([
      server("a.example"),
      server("b.example"),
    ]);
  });
});
