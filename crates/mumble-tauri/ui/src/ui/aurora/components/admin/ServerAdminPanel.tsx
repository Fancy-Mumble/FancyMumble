import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@core/store";
import type { AclData, AclEntry, BanEntry, RegisteredUser } from "@core/types";
import { PERMISSIONS } from "@core/utils/permissions";
import { Button, ModalSurface, TextField } from "../primitives";
import ServerSettingsEditor from "./ServerSettingsEditor";
import { PluginMarketplace, ServerPluginManager } from "./PluginAdmin";
import CustomEmotesAdmin from "./CustomEmotesAdmin";
import RolesAdmin from "./RolesAdmin";
import styles from "./ServerAdminPanel.module.css";

type Tab = "settings" | "users" | "roles" | "bans" | "acl" | "emotes" | "plugins" | "marketplace";
const blankBan = (): BanEntry => ({
  address: "",
  mask: 128,
  name: "",
  hash: "",
  reason: "",
  start: new Date().toISOString(),
  duration: 0,
});
const blankRule = (): AclEntry => ({
  apply_here: true,
  apply_subs: true,
  inherited: false,
  user_id: null,
  group: "all",
  grant: 0,
  deny: 0,
});

export default function ServerAdminPanel({
  onClose,
  initialTab = "settings",
  initialPluginId,
}: {
  onClose: () => void;
  initialTab?: Tab;
  initialPluginId?: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [removedUserIds, setRemovedUserIds] = useState<number[]>([]);
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [acl, setAcl] = useState<AclData | null>(null);
  const [channelId, setChannelId] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const channels = useAppStore((state) => state.channels);
  useEffect(() => {
    if (tab === "roles" && channelId !== 0) setChannelId(0);
  }, [channelId, tab]);
  useEffect(() => {
    let disposed = false;
    const offs: Array<() => void> = [];
    void Promise.all([
      listen<RegisteredUser[]>("user-list", (event) => {
        if (!disposed) {
          setUsers(event.payload);
          setRemovedUserIds([]);
        }
      }),
      listen<BanEntry[]>("ban-list", (event) => {
        if (!disposed) setBans(event.payload);
      }),
      listen<AclData>("acl", (event) => {
        if (!disposed && event.payload.channel_id === channelId) setAcl(event.payload);
      }),
    ])
      .then((values) => {
        if (disposed) values.forEach((off) => off());
        else offs.push(...values);
      })
      .then(() =>
        Promise.all([
          invoke("request_user_list"),
          invoke("request_ban_list"),
          invoke("request_acl", { channelId }),
        ]),
      )
      .catch((reason) => setStatus(String(reason)));
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, [channelId]);
  const refresh = () =>
    void (
      tab === "users"
        ? invoke("request_user_list")
        : tab === "bans"
          ? invoke("request_ban_list")
          : invoke("request_acl", { channelId })
    ).catch((reason) => setStatus(String(reason)));
  const saveUsers = async () => {
    await invoke("update_user_list", {
      users: [
        ...users.map(({ user_id, name }) => ({ user_id, name })),
        ...removedUserIds.map((user_id) => ({ user_id, name: null })),
      ],
    });
    setRemovedUserIds([]);
    refresh();
    setStatus("Registered users saved.");
  };
  const saveBans = async () => {
    await invoke("update_ban_list", { bans });
    refresh();
    setStatus("Ban list saved.");
  };
  const saveAcl = async () => {
    if (!acl) return;
    await invoke("update_acl", { acl });
    refresh();
    setStatus("Channel ACL saved.");
  };
  const patchRule = (index: number, change: Partial<AclEntry>) =>
    setAcl((current) =>
      current
        ? {
            ...current,
            acls: current.acls.map((rule, ruleIndex) =>
              ruleIndex === index ? { ...rule, ...change } : rule,
            ),
          }
        : current,
    );
  const togglePermission = (index: number, field: "grant" | "deny", bit: number) =>
    setAcl((current) => {
      if (!current) return current;
      const other = field === "grant" ? "deny" : "grant";
      return {
        ...current,
        acls: current.acls.map((entry, ruleIndex) =>
          ruleIndex === index
            ? { ...entry, [field]: entry[field] ^ bit, [other]: entry[other] & ~bit }
            : entry,
        ),
      };
    });
  return (
    <ModalSurface
      title="Server administration"
      eyebrow="PERMISSIONS REQUIRED"
      onClose={onClose}
      className={styles.surface}
    >
      <div className={styles.layout}>
        <nav>
          {(["settings", "users", "roles", "bans", "acl", "emotes", "plugins", "marketplace"] as Tab[]).map(
            (item) => (
              <Button
                variant="bare"
                className={tab === item ? styles.active : undefined}
                key={item}
                onClick={() => setTab(item)}
              >
                {item === "acl"
                  ? "Channel access"
                  : item === "settings"
                    ? "Server settings"
                    : item === "plugins"
                      ? "Server plugins"
                      : item[0].toUpperCase() + item.slice(1)}
              </Button>
            ),
          )}
          {(tab === "users" || tab === "roles" || tab === "bans" || tab === "acl") && (
            <Button onClick={refresh}>Refresh</Button>
          )}
        </nav>
        <main>
          {status && (
            <div className={styles.status}>
              {status}
              <Button variant="bare" onClick={() => setStatus(null)}>
                Dismiss
              </Button>
            </div>
          )}
          {tab === "settings" && <ServerSettingsEditor />}
          {tab === "plugins" && <ServerPluginManager />}
          {tab === "marketplace" && <PluginMarketplace initialPluginId={initialPluginId} />}
          {tab === "emotes" && <CustomEmotesAdmin />}
          {tab === "roles" && <RolesAdmin acl={acl} users={users} onChange={setAcl} onSave={saveAcl} />}
          {tab === "users" && (
            <>
              <header>
                <div>
                  <h3>Registered users</h3>
                  <p>Rename or unregister certificate-bound accounts.</p>
                </div>
                <Button variant="primary" onClick={() => void saveUsers()}>
                  Save users
                </Button>
              </header>
              <div className={styles.rows}>
                {users.map((user, index) => (
                  <div className={styles.userRow} key={user.user_id}>
                    <b>#{user.user_id}</b>
                    <TextField
                      label="Username"
                      value={user.name}
                      onChange={(event) =>
                        setUsers((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, name: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <span>{user.last_seen || "Never seen"}</span>
                    <Button
                      variant="danger"
                      onClick={() => {
                        setRemovedUserIds((current) => [...current, user.user_id]);
                        setUsers((current) => current.filter((_, entryIndex) => entryIndex !== index));
                      }}
                    >
                      Unregister
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "bans" && (
            <>
              <header>
                <div>
                  <h3>Ban list</h3>
                  <p>Entries are applied together when saved.</p>
                </div>
                <Button onClick={() => setBans((current) => [...current, blankBan()])}>Add ban</Button>
                <Button variant="primary" onClick={() => void saveBans()}>
                  Save bans
                </Button>
              </header>
              <div className={styles.rows}>
                {bans.map((ban, index) => (
                  <div className={styles.banRow} key={`${ban.address}-${index}`}>
                    <TextField
                      label="Name"
                      value={ban.name}
                      onChange={(event) =>
                        setBans((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, name: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <TextField
                      label="Address"
                      value={ban.address}
                      onChange={(event) =>
                        setBans((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, address: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <TextField
                      label="Mask"
                      type="number"
                      min={0}
                      max={128}
                      value={ban.mask}
                      onChange={(event) =>
                        setBans((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, mask: Number(event.target.value) } : entry,
                          ),
                        )
                      }
                    />
                    <TextField
                      label="Reason"
                      value={ban.reason}
                      onChange={(event) =>
                        setBans((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, reason: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="danger"
                      onClick={() =>
                        setBans((current) => current.filter((_, entryIndex) => entryIndex !== index))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "acl" && (
            <>
              <header>
                <div>
                  <h3>Channel access control</h3>
                  <p>Edit effective group rules for a channel.</p>
                </div>
                <label>
                  Channel
                  <select
                    value={channelId}
                    onChange={(event) => {
                      setChannelId(Number(event.target.value));
                      setAcl(null);
                    }}
                  >
                    {channels.map((channel) => (
                      <option value={channel.id} key={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  onClick={() =>
                    setAcl((current) =>
                      current ? { ...current, acls: [...current.acls, blankRule()] } : current,
                    )
                  }
                >
                  Add rule
                </Button>
                <Button variant="primary" disabled={!acl} onClick={() => void saveAcl()}>
                  Save ACL
                </Button>
              </header>
              {acl ? (
                <>
                  <label className={styles.inherit}>
                    <input
                      type="checkbox"
                      checked={acl.inherit_acls}
                      onChange={(event) => setAcl({ ...acl, inherit_acls: event.target.checked })}
                    />
                    Inherit parent ACLs
                  </label>
                  <div className={styles.groups}>
                    Groups:{" "}
                    {acl.groups.map((group) => (
                      <b key={group.name}>
                        {group.name} ({new Set([...group.add, ...group.inherited_members]).size})
                      </b>
                    ))}
                  </div>
                  <div className={styles.rules}>
                    {acl.acls.map((rule, index) => (
                      <article key={index}>
                        <header>
                          <TextField
                            label="Group"
                            value={rule.group ?? ""}
                            disabled={rule.inherited}
                            onChange={(event) =>
                              patchRule(index, { group: event.target.value || null, user_id: null })
                            }
                          />
                          <label>
                            <input
                              type="checkbox"
                              checked={rule.apply_here}
                              disabled={rule.inherited}
                              onChange={(event) => patchRule(index, { apply_here: event.target.checked })}
                            />
                            This channel
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={rule.apply_subs}
                              disabled={rule.inherited}
                              onChange={(event) => patchRule(index, { apply_subs: event.target.checked })}
                            />
                            Subchannels
                          </label>
                          {!rule.inherited && (
                            <Button
                              variant="danger"
                              onClick={() =>
                                setAcl({
                                  ...acl,
                                  acls: acl.acls.filter((_, ruleIndex) => ruleIndex !== index),
                                })
                              }
                            >
                              Remove
                            </Button>
                          )}
                        </header>
                        <div>
                          {PERMISSIONS.map((permission) => (
                            <span key={permission.bit}>
                              <small>{permission.label}</small>
                              <Button
                                variant={(rule.grant & permission.bit) !== 0 ? "secondary" : "bare"}
                                onClick={() => togglePermission(index, "grant", permission.bit)}
                              >
                                Allow
                              </Button>
                              <Button
                                variant={(rule.deny & permission.bit) !== 0 ? "danger" : "bare"}
                                onClick={() => togglePermission(index, "deny", permission.bit)}
                              >
                                Deny
                              </Button>
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className={styles.loading}>Loading channel permissions…</div>
              )}
            </>
          )}
        </main>
      </div>
    </ModalSurface>
  );
}
