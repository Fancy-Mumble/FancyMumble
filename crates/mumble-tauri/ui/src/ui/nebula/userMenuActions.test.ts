import { describe, expect, it } from "vitest";
import type { ChannelEntry, UserEntry } from "@core/types";
import {
  PERM_BAN,
  PERM_KICK,
  PERM_MOVE,
  PERM_MUTE_DEAFEN,
  PERM_REGISTER,
  PERM_RESET_USER_CONTENT,
} from "@core/utils/permissions";
import { userMenuActions } from "./selectors";

const channel = (id: number, permissions: number): ChannelEntry =>
  ({ id, name: `c${id}`, parent_id: 0, permissions }) as unknown as ChannelEntry;

const user = (partial: Partial<UserEntry> = {}): UserEntry =>
  ({ session: 7, name: "ZewiWin", channel_id: 4, user_id: 3, ...partial }) as UserEntry;

/** Root grants one thing, the channel the target sits in grants another. */
const ask = (
  partial: Partial<UserEntry>,
  rootPermissions: number,
  targetChannelPermissions: number,
  ownSession: number | null = 1,
  currentChannel: number | null = 2,
) =>
  userMenuActions({
    user: user(partial),
    channels: [channel(0, rootPermissions), channel(2, 0), channel(4, targetChannelPermissions)],
    ownSession,
    currentChannel,
  });

describe("userMenuActions", () => {
  it("grants nothing when the server has granted nothing", () => {
    const actions = ask({}, 0, 0);
    expect(actions.hasModeration).toBe(false);
    expect(actions.canMuteDeafen).toBe(false);
    expect(actions.canKick).toBe(false);
  });

  it("reads mute, deafen and move on the channel the target is sitting in", () => {
    const actions = ask({}, 0, PERM_MUTE_DEAFEN | PERM_MOVE);
    expect(actions.canMuteDeafen).toBe(true);
    expect(actions.canMove).toBe(true);
    expect(actions.hasModeration).toBe(true);
  });

  it("does not take those from the root channel, where they do not apply", () => {
    const actions = ask({}, PERM_MUTE_DEAFEN | PERM_MOVE, 0);
    expect(actions.canMuteDeafen).toBe(false);
    expect(actions.canMove).toBe(false);
  });

  it("reads kick, ban and content resets at the root", () => {
    const actions = ask({}, PERM_KICK | PERM_BAN | PERM_RESET_USER_CONTENT, 0);
    expect(actions.canKick).toBe(true);
    expect(actions.canBan).toBe(true);
    expect(actions.canResetContent).toBe(true);
  });

  it("does not take kick from the channel the target happens to be in", () => {
    expect(ask({}, 0, PERM_KICK).canKick).toBe(false);
  });

  it("offers registration to an unregistered user and deregistration to a registered one", () => {
    expect(ask({ user_id: null }, PERM_REGISTER, 0).canRegister).toBe(true);
    expect(ask({ user_id: null }, PERM_REGISTER, 0).canUnregister).toBe(false);
    expect(ask({ user_id: 3 }, PERM_REGISTER, 0).canUnregister).toBe(true);
    expect(ask({ user_id: 3 }, PERM_REGISTER, 0).canRegister).toBe(false);
  });

  it("treats SuperUser as unregistered, so its account is never deletable", () => {
    expect(ask({ user_id: 0 }, PERM_REGISTER, 0).canUnregister).toBe(false);
  });

  it("offers joining the target's channel only from a different one", () => {
    expect(ask({ channel_id: 4 }, 0, 0, 1, 2).canJoinChannel).toBe(true);
    expect(ask({ channel_id: 4 }, 0, 0, 1, 4).canJoinChannel).toBe(false);
  });

  it("names the channel the target is in, for the join label", () => {
    expect(ask({}, 0, 0).userChannel?.id).toBe(4);
  });

  it("grants nothing at all against yourself, however permitted you are", () => {
    const actions = ask(
      { session: 1 },
      PERM_KICK | PERM_BAN | PERM_REGISTER | PERM_RESET_USER_CONTENT,
      PERM_MUTE_DEAFEN | PERM_MOVE,
    );
    expect(actions.isSelf).toBe(true);
    expect(actions.hasModeration).toBe(false);
    expect(actions.canJoinChannel).toBe(false);
  });
});
