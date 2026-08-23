import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Box, Button, Checkbox, IconButton, Menu, MenuItem, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { acquireRegisteredTextures, releaseRegisteredTextures } from "@core/registeredTextureLease";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { PERMISSIONS, PERM_ENTER } from "@core/utils/permissions";
import { filterVisibleChannels, isDmChannel } from "@core/utils/channelVisibility";
import {
  buildChannelTree,
  computeChannelAccess,
  hasCustomAcl,
  limitTreeDepth,
  type TreeNode,
} from "@core/features/admin/channelAclModel";
import type { AclData, AclEntry, AclGroup, ChannelEntry, RegisteredUser } from "@core/types";
import { ChevronRightIcon, CloseIcon, LockIcon, TrashIcon } from "@ui/icons";
import { SearchBox, Stack, StatusDot } from "../primitives";
import { EmptyState, SegmentedGroup, SettingsCard } from "../settings/controls";
import { AdminPage, DetailPlaceholder } from "./controls";
import { radius } from "../../tokens";

const NO_LISTENED_CHANNELS: ReadonlySet<number> = new Set();

type AclTab = "rules" | "groups" | "users";

/** Channel ids whose own name, or a descendant's, matches the query. */
function filterTree(nodes: readonly TreeNode[], query: string): Set<number> {
  const matched = new Set<number>();
  const lower = query.toLowerCase();
  const walk = (node: TreeNode): boolean => {
    const self = node.channel.name.toLowerCase().includes(lower);
    // Not short-circuited: every descendant has to be visited, or a branch
    // below the first match would be pruned out of the result.
    let child = false;
    for (const kid of node.children) if (walk(kid)) child = true;
    if (self || child) {
      matched.add(node.channel.id);
      return true;
    }
    return false;
  };
  for (const node of nodes) walk(node);
  return matched;
}

/**
 * Channel permissions.
 *
 * Three columns: the channel tree, the selected channel's ACL, and the tree's
 * filters. The filters are their own column rather than a menu because they
 * change what the tree shows, and a filter you cannot see is indistinguishable
 * from a channel that does not exist.
 */
export function AclAdmin({ initialChannel }: Readonly<{ initialChannel?: number | null }>) {
  const { t } = useTranslation("settings");
  const channels = useAppStore((state) => state.channels);
  const users = useAppStore((state) => state.users);
  const deleteChannel = useAppStore((state) => state.deleteChannel);

  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [aclData, setAclData] = useState<AclData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [hideDmChannels, setHideDmChannels] = useState(false);
  const [hideEmptyChannels, setHideEmptyChannels] = useState(false);
  const [privateOnly, setPrivateOnly] = useState(false);
  const [topLevelOnly, setTopLevelOnly] = useState(false);
  const [customAclOnly, setCustomAclOnly] = useState(false);
  const [customAclCache, setCustomAclCache] = useState<Map<number, boolean>>(new Map());
  const [activeTab, setActiveTab] = useState<AclTab>("rules");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [registeredNames, setRegisteredNames] = useState<Map<number, string>>(new Map());
  const [menu, setMenu] = useState<{
    anchor: { top: number; left: number };
    channel: ChannelEntry;
    confirming?: boolean;
  } | null>(null);

  const visibleChannels = useMemo(() => {
    let base = channels;
    if (hideDmChannels) base = base.filter((channel) => !isDmChannel(channel));
    if (privateOnly) base = base.filter((channel) => channel.detached);
    if (customAclOnly) base = base.filter((channel) => customAclCache.get(channel.id) === true);
    if (hideEmptyChannels) {
      base = filterVisibleChannels(base, users, {
        currentChannel: null,
        selectedChannel,
        listenedChannels: NO_LISTENED_CHANNELS,
      });
    }
    return base;
  }, [
    channels,
    users,
    hideDmChannels,
    privateOnly,
    customAclOnly,
    customAclCache,
    hideEmptyChannels,
    selectedChannel,
  ]);

  const tree = useMemo(() => {
    const built = buildChannelTree(visibleChannels);
    return topLevelOnly ? limitTreeDepth(built, 1) : built;
  }, [visibleChannels, topLevelOnly]);
  const matchedIds = useMemo(() => (search ? filterTree(tree, search) : null), [tree, search]);

  // "Custom ACL only" has no batch endpoint, so turning it on sweeps
  // `request_acl` across every channel not yet asked for; the shared listener
  // below files the answers into `customAclCache` as they arrive. The set of
  // already-requested ids is a ref rather than state so a response landing
  // mid-sweep cannot re-run this effect and re-ask for every channel still
  // outstanding - each is asked exactly once per session.
  const requestedCustomAcl = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!customAclOnly) return;
    for (const channel of channels) {
      if (!requestedCustomAcl.current.has(channel.id)) {
        requestedCustomAcl.current.add(channel.id);
        invoke("request_acl", { channelId: channel.id }).catch(() => undefined);
      }
    }
  }, [customAclOnly, channels]);
  const customAclLoading = customAclOnly && channels.some((channel) => !customAclCache.has(channel.id));

  useEffect(() => {
    if (tree.length > 0 && expanded.size === 0) setExpanded(new Set([tree[0].channel.id]));
  }, [tree, expanded.size]);

  // Listener before request, as everywhere else here: a fast server's answer
  // beats an un-awaited `listen()`, and user ACL entries would then show raw
  // ids instead of names for the rest of the session.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    acquireRegisteredTextures();
    void (async () => {
      const off = await listen<RegisteredUser[]>("user-list", (event) => {
        const map = new Map<number, string>();
        for (const user of event.payload) map.set(user.user_id, user.name);
        setRegisteredNames(map);
      });
      if (cancelled) return off();
      unlisten = off;
      invoke("request_user_list").catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      releaseRegisteredTextures();
    };
  }, []);

  // One subscription for the component's whole life, and the "is this for the
  // channel I selected?" test reads a *ref*. Both halves matter. Re-subscribing
  // per selection loses responses two ways on a fast server: the answer can
  // arrive before the effect re-runs, so the live listener still compares
  // against the previous selection and drops it; and `listen`/`unlisten` are
  // async IPC, so re-registration leaves a window with no listener at all.
  // Either way the pane sticks on "Loading ACL…". The ref is written
  // synchronously in `select`, before the request goes out, so it cannot lag.
  const selectedChannelRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const off = await listen<AclData>("acl", (event) => {
        const data = event.payload;
        // Fed regardless of selection, for the "custom ACL" filter's cache.
        setCustomAclCache((prev) => new Map(prev).set(data.channel_id, hasCustomAcl(data)));
        if (data.channel_id !== selectedChannelRef.current) return;
        setAclData(data);
        setLoading(false);
        setDirty(false);
      });
      if (cancelled) return off();
      unlisten = off;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const select = useCallback((channelId: number) => {
    selectedChannelRef.current = channelId;
    setSelectedChannel(channelId);
    setLoading(true);
    setAclData(null);
    invoke("request_acl", { channelId }).catch(() => setLoading(false));
  }, []);

  // Arriving from a channel's "Edit permissions": select it and expand every
  // ancestor, so the tree shows where it is rather than opening on the root
  // with a selection the reader cannot see. Consumed once - re-expanding on
  // every render would fight the reader collapsing a branch.
  const consumedDeepLink = useRef<number | null>(null);
  useEffect(() => {
    if (initialChannel == null || consumedDeepLink.current === initialChannel) return;
    if (channels.length === 0) return;
    const target = channels.find((channel) => channel.id === initialChannel);
    if (!target) return;
    consumedDeepLink.current = initialChannel;

    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    const ancestors = new Set<number>();
    let current: ChannelEntry | undefined = target;
    // The guard is against a parent cycle in malformed channel data, which
    // would otherwise hang the render.
    for (let guard = 0; current && guard < 256; guard += 1) {
      ancestors.add(current.id);
      const parent = current.parent_id;
      if (parent == null || parent === current.id) break;
      current = byId.get(parent);
    }
    setExpanded((prev) => new Set([...prev, ...ancestors]));
    select(initialChannel);
  }, [initialChannel, channels, select]);

  const patch = (next: AclData) => {
    setAclData(next);
    setDirty(true);
  };

  const save = async () => {
    if (!aclData) return;
    try {
      await invoke("update_acl", { acl: aclData });
      setDirty(false);
    } catch (e) {
      console.error("Failed to update ACL:", e);
    }
  };

  const selectedName = channels.find((channel) => channel.id === selectedChannel)?.name ?? "";

  // Registered users explicitly granted Enter, for the Users tab's count. A
  // deny cancels an earlier grant, so the two cannot simply be counted.
  const accessUserCount = useMemo(() => {
    if (!aclData) return 0;
    const granted = new Set<number>();
    for (const rule of aclData.acls) {
      if (rule.user_id == null) continue;
      if ((rule.deny & PERM_ENTER) !== 0) granted.delete(rule.user_id);
      else if ((rule.grant & PERM_ENTER) !== 0) granted.add(rule.user_id);
    }
    return granted.size;
  }, [aclData]);

  return (
    <AdminPage wide title={t("channelAcl.title")}>
      <Stack direction="row" gap={1.5} alignItems="stretch">
        <Box sx={{ flex: "none", width: 260 }}>
          <SearchBox value={search} onChange={setSearch} placeholder={t("channelAcl.searchChannels")} />
          <Box
            sx={(theme) => ({
              mt: "10px",
              p: "6px",
              maxHeight: "58vh",
              overflowY: "auto",
              borderRadius: radius("lg"),
              background: theme.palette.nebula.card,
              border: `1px solid ${theme.palette.nebula.line}`,
            })}
          >
            {tree.map((node) => (
              <ChannelTreeNode
                key={node.channel.id}
                node={node}
                depth={0}
                selected={selectedChannel}
                expanded={expanded}
                matchedIds={matchedIds}
                onSelect={select}
                onToggle={(id) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onContextMenu={(event, channel) => {
                  event.preventDefault();
                  setMenu({ anchor: { top: event.clientY, left: event.clientX }, channel });
                }}
              />
            ))}
          </Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, maxHeight: "64vh", overflowY: "auto" }}>
          {selectedChannel === null && !loading && (
            <DetailPlaceholder>{t("channelAcl.selectChannel")}</DetailPlaceholder>
          )}
          {loading && <DetailPlaceholder>{t("channelAcl.loadingAcl")}</DetailPlaceholder>}

          {aclData && !loading && (
            <>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
                <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{selectedName}</Typography>
                {dirty && (
                  <Button size="small" variant="contained" onClick={() => void save()}>
                    {t("channelAcl.saveChanges")}
                  </Button>
                )}
              </Stack>

              <Stack direction="row" alignItems="center" gap={1} sx={{ mt: "10px" }}>
                <Checkbox
                  size="small"
                  checked={aclData.inherit_acls}
                  onChange={() => patch({ ...aclData, inherit_acls: !aclData.inherit_acls })}
                  slotProps={{ input: { "aria-label": t("channelAcl.inheritAcls") } }}
                />
                <Typography sx={{ fontSize: 12.5 }}>{t("channelAcl.inheritAcls")}</Typography>
              </Stack>

              <Box sx={{ mt: "12px", mb: "14px" }}>
                <SegmentedGroup
                  ariaLabel={t("channelAcl.title")}
                  value={activeTab}
                  onChange={setActiveTab}
                  options={[
                    { id: "rules", label: t("channelAcl.tabRules", { count: aclData.acls.length }) },
                    { id: "groups", label: t("channelAcl.tabGroups", { count: aclData.groups.length }) },
                    { id: "users", label: t("channelAcl.tabUsers", { count: accessUserCount }) },
                  ]}
                />
              </Box>

              {activeTab === "rules" && <AclRules acl={aclData} onChange={patch} />}
              {activeTab === "groups" && (
                <AclGroups
                  acl={aclData}
                  users={users}
                  registeredNames={registeredNames}
                  onChange={patch}
                />
              )}
              {activeTab === "users" && (
                <AccessUsers acl={aclData} users={users} registeredNames={registeredNames} />
              )}
            </>
          )}
        </Box>

        <Box sx={{ flex: "none", width: 230 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "8px" }}>
            {t("channelAcl.filtersTitle")}
          </Typography>
          <SettingsCard>
            <FilterRow
              label={t("channelAcl.hideDmChannels")}
              checked={hideDmChannels}
              onChange={setHideDmChannels}
              testId={TID.aclHideDmChannels}
            />
            <FilterRow
              label={t("channelAcl.hideEmptyChannels")}
              checked={hideEmptyChannels}
              onChange={setHideEmptyChannels}
              testId={TID.aclHideEmptyChannels}
            />
            <FilterRow
              label={t("channelAcl.privateOnly")}
              checked={privateOnly}
              onChange={setPrivateOnly}
              testId={TID.aclPrivateOnly}
            />
            <FilterRow
              label={t("channelAcl.topLevelOnly")}
              checked={topLevelOnly}
              onChange={setTopLevelOnly}
              testId={TID.aclTopLevelOnly}
            />
            <FilterRow
              label={t("channelAcl.customAclOnly")}
              checked={customAclOnly}
              onChange={setCustomAclOnly}
              testId={TID.aclCustomAclOnly}
              hint={customAclLoading ? t("channelAcl.customAclLoading") : undefined}
            />
          </SettingsCard>
        </Box>
      </Stack>

      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu?.anchor}
      >
        {menu?.confirming ? (
          <Box sx={{ px: "10px", py: "8px", maxWidth: 240 }}>
            <Typography sx={{ fontSize: 12, mb: "8px" }}>
              {t("channelAcl.confirmDeleteChannel", { name: menu.channel.name })}
            </Typography>
            <Stack direction="row" gap={0.75}>
              <Button
                size="small"
                color="error"
                variant="contained"
                data-testid={TID.aclDeleteConfirm}
                onClick={() => {
                  const channel = menu.channel;
                  setMenu(null);
                  void deleteChannel(channel.id)
                    .then(() => {
                      if (selectedChannelRef.current !== channel.id) return;
                      selectedChannelRef.current = null;
                      setSelectedChannel(null);
                      setAclData(null);
                    })
                    .catch((e) => console.error("Failed to delete channel:", e));
                }}
              >
                {t("channelAcl.deleteChannel")}
              </Button>
              <Button size="small" onClick={() => setMenu(null)}>
                {t("channelAcl.cancelDelete", { defaultValue: "Cancel" })}
              </Button>
            </Stack>
          </Box>
        ) : (
          <MenuItem
            data-testid={TID.aclDeleteChannel}
            sx={(theme) => ({ color: theme.palette.nebula.bad })}
            onClick={() => setMenu((prev) => (prev ? { ...prev, confirming: true } : prev))}
          >
            <TrashIcon width={14} height={14} />
            {t("channelAcl.deleteChannel")}
          </MenuItem>
        )}
      </Menu>
    </AdminPage>
  );
}

function FilterRow({
  label,
  checked,
  onChange,
  testId,
  hint,
}: Readonly<{
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId: string;
  hint?: string;
}>) {
  return (
    <Stack direction="row" alignItems="center" gap={1} sx={{ py: "3px" }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 11.5 }}>{label}</Typography>
        {hint && (
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {hint}
          </Typography>
        )}
      </Box>
      <Checkbox
        size="small"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        // The suites address the switch itself, so the attribute has to land
        // on the real `<input>`. MUI's slot typing has no room for arbitrary
        // data attributes, which is all the cast is for.
        slotProps={{
          input: { "aria-label": label, "data-testid": testId } as InputHTMLAttributes<HTMLInputElement>,
        }}
        sx={{ flex: "none" }}
      />
    </Stack>
  );
}

function ChannelTreeNode({
  node,
  depth,
  selected,
  expanded,
  matchedIds,
  onSelect,
  onToggle,
  onContextMenu,
}: Readonly<{
  node: TreeNode;
  depth: number;
  selected: number | null;
  expanded: Set<number>;
  matchedIds: Set<number> | null;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onContextMenu: (event: ReactMouseEvent, channel: ChannelEntry) => void;
}>) {
  const { t } = useTranslation("settings");
  const id = node.channel.id;
  const isExpanded = expanded.has(id);
  const hasChildren = node.children.length > 0;
  const isPrivate = node.channel.detached === true;

  if (matchedIds && !matchedIds.has(id)) return null;

  return (
    <>
      <Box
        component="button"
        data-testid={TID.aclChannelItem}
        data-channel-id={id}
        data-channel-name={node.channel.name}
        data-private={isPrivate ? "true" : undefined}
        onClick={() => onSelect(id)}
        onContextMenu={(event: ReactMouseEvent) => onContextMenu(event, node.channel)}
        sx={(theme) => ({
          all: "unset",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: "5px",
          width: "100%",
          cursor: "pointer",
          pl: `${8 + depth * 14}px`,
          pr: "9px",
          py: "6px",
          borderRadius: radius("md"),
          fontSize: 12,
          color: selected === id ? theme.palette.nebula.text : theme.palette.nebula.muted,
          background: selected === id ? theme.palette.nebula.accentSoft : "transparent",
          "&:hover": {
            background: selected === id ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover,
          },
        })}
      >
        {hasChildren ? (
          <Box
            component="span"
            role="button"
            tabIndex={-1}
            // Stops the click reaching the row: expanding a branch is not the
            // same gesture as selecting the channel it belongs to.
            onClick={(event: ReactMouseEvent) => {
              event.stopPropagation();
              onToggle(id);
            }}
            sx={{ flex: "none", display: "flex", alignItems: "center" }}
          >
            <ChevronRightIcon
              width={11}
              height={11}
              style={{
                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform .15s",
              }}
            />
          </Box>
        ) : (
          <Box component="span" sx={{ flex: "none", width: 11 }} />
        )}
        {isPrivate && <LockIcon width={10} height={10} style={{ flex: "none" }} />}
        <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {node.channel.name}
        </Box>
        {isPrivate && (
          <Box component="span" sx={(theme) => ({ flex: "none", fontSize: 9.5, color: theme.palette.nebula.dim })}>
            {t("channelAcl.privateBadge")}
          </Box>
        )}
      </Box>
      {isExpanded &&
        node.children.map((child) => (
          <ChannelTreeNode
            key={child.channel.id}
            node={child}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            matchedIds={matchedIds}
            onSelect={onSelect}
            onToggle={onToggle}
            onContextMenu={onContextMenu}
          />
        ))}
    </>
  );
}

/** The channel's ACL rules: who, and which permissions they grant or deny. */
function AclRules({ acl, onChange }: Readonly<{ acl: AclData; onChange: (next: AclData) => void }>) {
  const { t } = useTranslation("settings");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const patchRule = (index: number, patch: Partial<AclEntry>) =>
    onChange({ ...acl, acls: acl.acls.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: "10px" }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{t("aclRules.sectionTitle")}</Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={() =>
            onChange({
              ...acl,
              acls: [
                ...acl.acls,
                {
                  apply_here: true,
                  apply_subs: true,
                  inherited: false,
                  user_id: null,
                  group: "all",
                  grant: 0,
                  deny: 0,
                },
              ],
            })
          }
        >
          {t("aclRules.addRule")}
        </Button>
      </Stack>

      {acl.acls.length === 0 ? (
        <EmptyState>{t("aclRules.noRules")}</EmptyState>
      ) : (
        <Stack gap={0.75}>
          {acl.acls.map((entry, index) => {
            const open = openIndex === index;
            const label = entry.group
              ? `@${entry.group}`
              : entry.user_id != null
                ? `User #${entry.user_id}`
                : t("aclRules.unknownEntry");
            return (
              <SettingsCard key={`acl-${index}`} sx={{ p: 0, overflow: "hidden" }}>
                <Stack
                  direction="row"
                  alignItems="center"
                  gap={1}
                  sx={{ px: "12px", py: "9px", cursor: "pointer" }}
                  onClick={() => setOpenIndex(open ? null : index)}
                >
                  <ChevronRightIcon
                    width={11}
                    height={11}
                    style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", flex: "none" }}
                  />
                  <Typography sx={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500 }} noWrap>
                    {label}
                  </Typography>
                  {entry.inherited ? (
                    <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
                      {t("aclRules.inherited")}
                    </Typography>
                  ) : (
                    <IconButton
                      size="small"
                      aria-label={t("aclRules.addRule")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onChange({ ...acl, acls: acl.acls.filter((_, i) => i !== index) });
                        setOpenIndex(null);
                      }}
                    >
                      <CloseIcon width={12} height={12} />
                    </IconButton>
                  )}
                </Stack>

                {open && (
                  <Box
                    sx={(theme) => ({
                      px: "12px",
                      pb: "12px",
                      borderTop: `1px solid ${theme.palette.nebula.line}`,
                      pt: "10px",
                    })}
                  >
                    <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mb: "10px" }}>
                      <LabelledCheckbox
                        label={t("aclRules.applyHere")}
                        checked={entry.apply_here}
                        disabled={entry.inherited}
                        onChange={(apply_here) => patchRule(index, { apply_here })}
                      />
                      <LabelledCheckbox
                        label={t("aclRules.applySubChannels")}
                        checked={entry.apply_subs}
                        disabled={entry.inherited}
                        onChange={(apply_subs) => patchRule(index, { apply_subs })}
                      />
                    </Stack>

                    {!entry.inherited && (
                      <Stack direction="row" gap={1.25} sx={{ mb: "12px" }}>
                        <TextField
                          size="small"
                          label={t("aclRules.labelGroup")}
                          value={entry.group ?? ""}
                          // A rule targets a group or a user, never both, so
                          // filling one clears the other.
                          onChange={(event) =>
                            patchRule(index, { group: event.target.value || null, user_id: null })
                          }
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          size="small"
                          type="number"
                          label={t("aclRules.labelUserId")}
                          value={entry.user_id ?? ""}
                          onChange={(event) =>
                            patchRule(index, {
                              user_id: event.target.value ? Number(event.target.value) : null,
                              group: null,
                            })
                          }
                          sx={{ flex: 1 }}
                        />
                      </Stack>
                    )}

                    <Box
                      sx={(theme) => ({
                        display: "grid",
                        gridTemplateColumns: "1fr 56px 56px",
                        alignItems: "center",
                        fontSize: 11.5,
                        "& > *": { py: "2px" },
                        "& .head": {
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.07em",
                          textTransform: "uppercase",
                          color: theme.palette.nebula.dim,
                          borderBottom: `1px solid ${theme.palette.nebula.line}`,
                          pb: "5px",
                          mb: "3px",
                        },
                      })}
                    >
                      <Box className="head">{t("aclRules.colPermission")}</Box>
                      <Box className="head" sx={{ textAlign: "center" }}>
                        {t("aclRules.colAllow")}
                      </Box>
                      <Box className="head" sx={{ textAlign: "center" }}>
                        {t("aclRules.colDeny")}
                      </Box>
                      {PERMISSIONS.map(({ bit, label: permission }) => (
                        <Box key={bit} sx={{ display: "contents" }}>
                          <Box>{permission}</Box>
                          <Box sx={{ textAlign: "center" }}>
                            <Checkbox
                              size="small"
                              checked={(entry.grant & bit) !== 0}
                              disabled={entry.inherited}
                              onChange={() => patchRule(index, { grant: entry.grant ^ bit })}
                              slotProps={{
                                input: { "aria-label": `${permission} ${t("aclRules.colAllow")}` },
                              }}
                            />
                          </Box>
                          <Box sx={{ textAlign: "center" }}>
                            <Checkbox
                              size="small"
                              checked={(entry.deny & bit) !== 0}
                              disabled={entry.inherited}
                              onChange={() => patchRule(index, { deny: entry.deny ^ bit })}
                              slotProps={{
                                input: { "aria-label": `${permission} ${t("aclRules.colDeny")}` },
                              }}
                            />
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
              </SettingsCard>
            );
          })}
        </Stack>
      )}
    </>
  );
}

interface UserLike {
  session: number;
  name: string;
  user_id?: number | null;
}

/** The channel's own groups, and who is in or out of each. */
function AclGroups({
  acl,
  users,
  registeredNames,
  onChange,
}: Readonly<{
  acl: AclData;
  users: readonly UserLike[];
  registeredNames: Map<number, string>;
  onChange: (next: AclData) => void;
}>) {
  const { t } = useTranslation("settings");

  const patchGroup = (index: number, patch: Partial<AclGroup>) =>
    onChange({
      ...acl,
      groups: acl.groups.map((group, i) => (i === index ? { ...group, ...patch } : group)),
    });

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: "10px" }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{t("groups.sectionTitle")}</Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={() =>
            onChange({
              ...acl,
              groups: [
                ...acl.groups,
                {
                  name: "new_group",
                  inherited: false,
                  inherit: true,
                  inheritable: true,
                  add: [],
                  remove: [],
                  inherited_members: [],
                },
              ],
            })
          }
        >
          {t("groups.addGroup")}
        </Button>
      </Stack>

      {acl.groups.length === 0 ? (
        <EmptyState>{t("groups.noGroups")}</EmptyState>
      ) : (
        <Stack gap={0.75}>
          {acl.groups.map((group, index) => (
            <GroupCard
              key={`group-${index}`}
              group={group}
              users={users}
              registeredNames={registeredNames}
              onPatch={(patch) => patchGroup(index, patch)}
              onRemove={() => onChange({ ...acl, groups: acl.groups.filter((_, i) => i !== index) })}
            />
          ))}
        </Stack>
      )}
    </>
  );
}

function GroupCard({
  group,
  users,
  registeredNames,
  onPatch,
  onRemove,
}: Readonly<{
  group: AclGroup;
  users: readonly UserLike[];
  registeredNames: Map<number, string>;
  onPatch: (patch: Partial<AclGroup>) => void;
  onRemove: () => void;
}>) {
  const { t } = useTranslation("settings");
  const [addInput, setAddInput] = useState("");
  const [removeInput, setRemoveInput] = useState("");
  const locked = group.inherited;

  // The field takes an id or a name, because the admin has one or the other to
  // hand depending on where they came from.
  const resolveUserId = (input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber;
    return (
      users.find(
        (user) => user.name.toLowerCase() === trimmed.toLowerCase() && user.user_id != null,
      )?.user_id ?? null
    );
  };

  const nameFor = (id: number): string =>
    users.find((user) => user.user_id === id)?.name ?? registeredNames.get(id) ?? `User #${id}`;

  const memberList = (
    ids: readonly number[],
    onDrop: (id: number) => void,
    heading: string,
    removable: boolean,
  ) => (
    <Box sx={{ mt: "10px" }}>
      <Typography sx={(theme) => ({ fontSize: 11, fontWeight: 600, color: theme.palette.nebula.muted })}>
        {heading}
      </Typography>
      <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: "5px" }}>
        {ids.map((id) => (
          <Stack
            key={id}
            direction="row"
            alignItems="center"
            gap={0.375}
            sx={(theme) => ({
              px: "8px",
              py: "3px",
              borderRadius: "999px",
              fontSize: 11,
              background: theme.palette.nebula.card2,
            })}
          >
            {nameFor(id)}
            {removable && !locked && (
              <Box
                component="button"
                aria-label={`${t("groups.excludeButton")} ${nameFor(id)}`}
                onClick={() => onDrop(id)}
                sx={{ all: "unset", cursor: "pointer", display: "flex", opacity: 0.6 }}
              >
                <CloseIcon width={10} height={10} />
              </Box>
            )}
          </Stack>
        ))}
      </Stack>
    </Box>
  );

  return (
    <SettingsCard>
      <Stack direction="row" alignItems="center" gap={1}>
        <TextField
          size="small"
          sx={{ flex: 1 }}
          value={group.name}
          disabled={locked}
          onChange={(event) => onPatch({ name: event.target.value })}
          slotProps={{ htmlInput: { "aria-label": t("groups.sectionTitle") } }}
        />
        {locked ? (
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {t("groups.labelInherit")}
          </Typography>
        ) : (
          <IconButton size="small" aria-label={t("groups.excludeButton")} onClick={onRemove}>
            <CloseIcon width={12} height={12} />
          </IconButton>
        )}
      </Stack>

      <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mt: "8px" }}>
        <LabelledCheckbox
          label={t("groups.labelInherit")}
          checked={group.inherit}
          disabled={locked}
          onChange={(inherit) => onPatch({ inherit })}
        />
        <LabelledCheckbox
          label={t("groups.labelInheritable")}
          checked={group.inheritable}
          disabled={locked}
          onChange={(inheritable) => onPatch({ inheritable })}
        />
      </Stack>

      {group.inherited_members.length > 0 &&
        memberList(group.inherited_members, () => undefined, t("groups.inheritedMembers"), false)}

      {memberList(
        group.add,
        (id) => onPatch({ add: group.add.filter((member) => member !== id) }),
        t("groups.membersToAdd"),
        true,
      )}
      {!locked && (
        <MemberEntryRow
          value={addInput}
          placeholder={t("groups.userIdPlaceholder")}
          action={t("groups.addButton")}
          onChange={setAddInput}
          onSubmit={() => {
            const id = resolveUserId(addInput);
            if (id === null || group.add.includes(id)) return;
            onPatch({ add: [...group.add, id] });
            setAddInput("");
          }}
        />
      )}

      {memberList(
        group.remove,
        (id) => onPatch({ remove: group.remove.filter((member) => member !== id) }),
        t("groups.membersToRemove"),
        true,
      )}
      {!locked && (
        <MemberEntryRow
          value={removeInput}
          placeholder={t("groups.userIdPlaceholder")}
          action={t("groups.excludeButton")}
          onChange={setRemoveInput}
          onSubmit={() => {
            const id = resolveUserId(removeInput);
            if (id === null || group.remove.includes(id)) return;
            onPatch({ remove: [...group.remove, id] });
            setRemoveInput("");
          }}
        />
      )}
    </SettingsCard>
  );
}

function MemberEntryRow({
  value,
  placeholder,
  action,
  onChange,
  onSubmit,
}: Readonly<{
  value: string;
  placeholder: string;
  action: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}>) {
  return (
    <Stack direction="row" gap={0.75} sx={{ mt: "7px" }}>
      <TextField
        size="small"
        sx={{ flex: 1 }}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && onSubmit()}
        slotProps={{ htmlInput: { "aria-label": placeholder } }}
      />
      <Button size="small" variant="outlined" onClick={onSubmit}>
        {action}
      </Button>
    </Stack>
  );
}

function LabelledCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: Readonly<{
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}>) {
  return (
    <Stack direction="row" alignItems="center" gap={0.5}>
      <Checkbox
        size="small"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        slotProps={{ input: { "aria-label": label } }}
      />
      <Typography sx={{ fontSize: 11.5 }}>{label}</Typography>
    </Stack>
  );
}

/**
 * Who can actually enter this channel, derived from the rules.
 *
 * Read-only, and the read-only counterpart to the two editors beside it: the
 * rules say what is granted, this says who that adds up to - which is the
 * question an admin opening a private channel's ACL is usually asking.
 */
function AccessUsers({
  acl,
  users,
  registeredNames,
}: Readonly<{ acl: AclData; users: readonly UserLike[]; registeredNames: Map<number, string> }>) {
  const { t } = useTranslation("settings");
  const access = useMemo(() => computeChannelAccess(acl.acls, acl.groups), [acl]);

  const onlineIds = useMemo(() => {
    const set = new Set<number>();
    for (const user of users) if (user.user_id != null) set.add(user.user_id);
    return set;
  }, [users]);

  const nameFor = (id: number) =>
    registeredNames.get(id) ?? users.find((user) => user.user_id === id)?.name ?? `#${id}`;

  const userRow = (id: number, withHint: boolean) => {
    const online = onlineIds.has(id);
    return (
      <Stack key={id} direction="row" alignItems="center" gap={1} sx={{ py: "3px" }}>
        <StatusDot status={online ? "online" : "offline"} />
        <Typography sx={{ fontSize: 12 }}>{nameFor(id)}</Typography>
        {withHint && online && (
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {t("channelAcl.accessOnlineHint")}
          </Typography>
        )}
      </Stack>
    );
  };

  const nothing =
    !access.allUsers &&
    !access.allRegistered &&
    access.granted.length === 0 &&
    access.groupMembers.size === 0;

  return (
    <Box>
      {access.allUsers && <SettingsCard>{t("channelAcl.accessAllUsers")}</SettingsCard>}
      {!access.allUsers && access.allRegistered && (
        <SettingsCard>{t("channelAcl.accessAllRegistered")}</SettingsCard>
      )}

      {access.granted.length > 0 && (
        <Box sx={{ mt: "12px" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "5px" }}>
            {t("channelAcl.accessUsersHeading")}
          </Typography>
          {access.granted
            .map((id) => ({ id, name: nameFor(id) }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ id }) => userRow(id, true))}
        </Box>
      )}

      {[...access.groupMembers.entries()].map(([group, members]) => (
        <Box key={group} sx={{ mt: "12px" }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: "5px" }}>
            {t("channelAcl.accessViaGroup", { group })}
          </Typography>
          {members.length === 0 ? (
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.dim })}>—</Typography>
          ) : (
            members.map((id) => userRow(id, false))
          )}
        </Box>
      ))}

      {nothing && <EmptyState>{t("channelAcl.accessNoneExplicit")}</EmptyState>}
    </Box>
  );
}
