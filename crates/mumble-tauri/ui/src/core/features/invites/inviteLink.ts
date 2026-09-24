/**
 * The invite link, both ways.
 *
 * `fancy://invite/<code>?server=<host:port>&name=<server name>`. The code is
 * what gets someone in; the address is where to dial; the name is only for
 * the "you've been invited to ..." line, and a link without it still works.
 */

export const DEFAULT_PORT = 64738;

/** What a link says. */
export interface ParsedInvite {
  code: string;
  host: string;
  port: number;
  /** The server's name as the inviter saw it; empty when the link had none. */
  name: string;
}

/** A code as Starling mints it, with room for a longer one later. */
const CODE = /^[a-z0-9]{1,64}$/i;

/**
 * Split `host`, `host:port` or `[v6]:port` into its parts, falling back to
 * `fallbackPort` when none is written.
 */
export function splitAddress(
  address: string,
  fallbackPort = DEFAULT_PORT,
): { host: string; port: number } | null {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(trimmed);
  if (bracketed) {
    const port = bracketed[2] ? Number(bracketed[2]) : fallbackPort;
    return validPort(port) ? { host: bracketed[1], port } : null;
  }
  const colons = trimmed.split(":").length - 1;
  if (colons === 1) {
    const [host, rawPort] = trimmed.split(":");
    const port = Number(rawPort);
    return host && validPort(port) ? { host, port } : null;
  }
  // No colon is a bare host; several without brackets is a bare IPv6 address.
  return { host: trimmed, port: fallbackPort };
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536;
}

function joinAddress(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

/**
 * The link for `code`.
 *
 * `advertised` is the server's `invite_address` setting when the operator set
 * one; it wins over `host`/`port`, the address this client dialled, because
 * the operator knows when that address is private.
 */
export function buildInviteLink(options: {
  code: string;
  host: string;
  port: number;
  advertised?: string;
  name?: string;
}): string {
  const dialled = { host: options.host, port: options.port };
  const target = (options.advertised && splitAddress(options.advertised, options.port)) || dialled;
  const params = new URLSearchParams({ server: joinAddress(target.host, target.port) });
  if (options.name?.trim()) params.set("name", options.name.trim());
  return `fancy://invite/${encodeURIComponent(options.code)}?${params.toString()}`;
}

/** Read a link, or `null` when it is not an invite link this client can follow. */
export function parseInviteLink(link: string): ParsedInvite | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "fancy:") return null;
  // `fancy://invite/<code>` parses with "invite" as the host in some engines
  // and as the first path segment in others; accept both.
  const segments = [url.host, ...url.pathname.split("/")].filter(Boolean);
  if (segments[0] !== "invite" || !segments[1]) return null;
  const code = decodeURIComponent(segments[1]);
  if (!CODE.test(code)) return null;
  const address = splitAddress(url.searchParams.get("server") ?? "");
  if (!address) return null;
  return { code, ...address, name: url.searchParams.get("name")?.trim() ?? "" };
}
