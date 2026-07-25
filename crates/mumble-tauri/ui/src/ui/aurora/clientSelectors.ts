/**
 * Pure derivations behind the client screens.
 *
 * These used to be `useMemo` bodies inside AuroraClientApp, reading a dozen
 * free variables out of component scope - which meant none of them could be
 * exercised without mounting the whole client. They take their inputs
 * explicitly instead, so each is testable on its own and screens can be moved
 * around without dragging the maths along.
 *
 * Message shapes are structural on purpose: these helpers only need the few
 * fields they read, so they do not couple to the store's concrete types.
 */
import type { ChannelEntry, RegisteredUser, SavedServer, UserEntry } from "@core/types";
import type { RailGroup, RailIdentity } from "./components";

export interface RailSession {
  id: string;
  host: string;
  port: number;
  username: string;
  label: string;
}

export interface RelatableMessage {
  sender_hash?: string | null;
  sender_name: string;
  body: string;
}

export interface UserRelationFlags {
  ignored?: boolean;
  blocked?: boolean;
}

/** How a message's sender is keyed in the relations map. */
export function senderRelationKey(message: RelatableMessage): string {
  return message.sender_hash
    ? `hash:${message.sender_hash}`
    : `name:${message.sender_name.toLocaleLowerCase()}`;
}

export function isFromIgnoredSender(
  message: RelatableMessage,
  relations: Record<string, UserRelationFlags>,
): boolean {
  return relations[senderRelationKey(message)]?.ignored ?? false;
}

/** Message bodies are HTML, so match the query against rendered text only. */
export function matchesChatQuery(message: RelatableMessage, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const text = new DOMParser().parseFromString(message.body, "text/html").body.textContent ?? "";
  return text.toLocaleLowerCase().includes(needle);
}

function isVisibleMessage(
  message: RelatableMessage,
  relations: Record<string, UserRelationFlags>,
  query: string,
): boolean {
  return !isFromIgnoredSender(message, relations) && matchesChatQuery(message, query);
}

/**
 * Every saved server plus any live session, grouped by host:port. Identities
 * (usernames) on the same address collapse into one stacked rail tile.
 */
export function groupServersForRail(
  savedServers: readonly SavedServer[] | null,
  sessions: readonly RailSession[],
): RailGroup[] {
  const identityKey = (host: string, port: number, username: string) =>
    `${host}:${port}:${username}`.toLowerCase();
  const groupKey = (host: string, port: number) => `${host}:${port}`.toLowerCase();
  const sessionByIdentity = new Map(
    sessions.map((session) => [identityKey(session.host, session.port, session.username), session]),
  );
  const groups = new Map<string, RailGroup & { identities: RailIdentity[] }>();

  const ensure = (key: string, seed: Omit<RailGroup, "identities"> & { identities: RailIdentity[] }) => {
    const existing = groups.get(key);
    if (existing) return existing;
    groups.set(key, seed);
    return seed;
  };

  for (const server of savedServers ?? []) {
    const key = groupKey(server.host, server.port);
    const group = ensure(key, {
      key,
      label: server.label,
      host: server.host,
      port: server.port,
      favorite: false,
      identities: [],
    });
    if (server.favorite) {
      group.favorite = true;
      group.label = server.label;
    }
    group.identities.push({
      id: server.id,
      label: server.label,
      host: server.host,
      port: server.port,
      username: server.username,
      favorite: server.favorite,
      sessionId: sessionByIdentity.get(identityKey(server.host, server.port, server.username))?.id ?? null,
    });
  }
  // Sessions without a saved entry (direct connects) still deserve a tile.
  for (const session of sessions) {
    const key = groupKey(session.host, session.port);
    const group = ensure(key, {
      key,
      label: session.label,
      host: session.host,
      port: session.port,
      favorite: false,
      identities: [],
    });
    if (!group.identities.some((identity) => identity.sessionId === session.id)) {
      group.identities.push({
        id: session.id,
        label: session.label,
        host: session.host,
        port: session.port,
        username: session.username,
        sessionId: session.id,
      });
    }
  }
  return [...groups.values()].sort(
    (left, right) =>
      Number(right.favorite) - Number(left.favorite) ||
      Number(right.identities.some((identity) => identity.sessionId)) -
        Number(left.identities.some((identity) => identity.sessionId)) ||
      left.label.localeCompare(right.label),
  );
}

/** Channels matching the filter, plus the ancestors needed to reach them. */
export function filterVisibleChannels(input: {
  channels: readonly ChannelEntry[];
  query: string;
  hideEmpty: boolean;
  currentChannel: number | null;
  selectedChannel: number | null;
}): ChannelEntry[] {
  const candidates = input.channels.filter((channel) => !channel.detached);
  const byId = new Map(candidates.map((channel) => [channel.id, channel]));
  const keep = new Set<number>();
  const includeWithAncestors = (channelId: number) => {
    let current = byId.get(channelId);
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
  };
  const needle = input.query.trim().toLocaleLowerCase();
  for (const channel of candidates) {
    const matchesSearch = !needle || channel.name.toLocaleLowerCase().includes(needle);
    const matchesVisibility =
      !input.hideEmpty ||
      channel.user_count > 0 ||
      channel.id === input.currentChannel ||
      channel.id === input.selectedChannel;
    if (matchesSearch && matchesVisibility) includeWithAncestors(channel.id);
  }
  return candidates.filter((channel) => keep.has(channel.id));
}

/** Registered-but-offline users are synthesised with a negative session id. */
function asOfflineEntry(user: RegisteredUser): UserEntry {
  return {
    session: -(user.user_id + 1),
    name: user.name,
    channel_id: user.last_channel ?? 0,
    user_id: user.user_id,
    texture_size: user.texture_size ?? null,
    comment: user.comment,
    mute: false,
    deaf: false,
    suppress: false,
    self_mute: false,
    self_deaf: false,
    priority_speaker: false,
  } as UserEntry;
}

/** Online users first, then talkers, then alphabetical. */
export function listChannelMembers(input: {
  users: readonly UserEntry[];
  registeredUsers: readonly RegisteredUser[];
  scope: "channel" | "server";
  query: string;
  selectedChannel: number | null;
  talkingSessions: ReadonlySet<number>;
}): UserEntry[] {
  const onlineIds = new Set(input.users.flatMap((user) => (user.user_id == null ? [] : [user.user_id])));
  const offline =
    input.scope === "server"
      ? input.registeredUsers.filter((user) => !onlineIds.has(user.user_id)).map(asOfflineEntry)
      : [];
  const query = input.query.trim().toLocaleLowerCase();
  return [
    ...input.users.filter((user) => input.scope === "server" || user.channel_id === input.selectedChannel),
    ...offline,
  ]
    .filter((user) => !query || user.name.toLocaleLowerCase().includes(query))
    .sort(
      (left, right) =>
        Number(left.session < 0) - Number(right.session < 0) ||
        Number(input.talkingSessions.has(right.session)) - Number(input.talkingSessions.has(left.session)) ||
        left.name.localeCompare(right.name),
    );
}

export function filterChannelMessages<
  T extends RelatableMessage & { channel_id?: number | null; dm_session?: number | null },
>(input: {
  messages: readonly T[];
  pollMessages: readonly T[];
  selectedChannel: number | null;
  relations: Record<string, UserRelationFlags>;
  query: string;
}): T[] {
  return [...input.messages, ...input.pollMessages].filter(
    (message) =>
      message.channel_id === input.selectedChannel &&
      !message.dm_session &&
      isVisibleMessage(message, input.relations, input.query),
  );
}

export function filterDmMessages<T extends RelatableMessage>(input: {
  dmMessages: readonly T[];
  blocked: boolean;
  relations: Record<string, UserRelationFlags>;
  query: string;
}): T[] {
  if (input.blocked) return [];
  return input.dmMessages.filter((message) => isVisibleMessage(message, input.relations, input.query));
}
