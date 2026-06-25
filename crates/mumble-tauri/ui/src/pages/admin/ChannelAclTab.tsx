import { ChevronRightIcon, LockIcon, TrashIcon } from "../../icons";
import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { acquireRegisteredTextures, releaseRegisteredTextures } from "../../registeredTextureLease";
import { listen } from "@tauri-apps/api/event";
import { useSearchParams } from "react-router-dom";
import { useAppStore } from "../../store";
import { TID } from "../../testids";
import { PERM_ENTER } from "../../utils/permissions";
import type { AclData, AclEntry, AclGroup, ChannelEntry, RegisteredUser } from "../../types";
import { AclRulesPanel } from "./AclRulesPanel";
import { GroupsPanel } from "./GroupsPanel";
import { AccessUsersPanel } from "./AccessUsersPanel";
import { buildChannelTree, type TreeNode } from "./channelAclModel";
import styles from "./AdminPanel.module.css";

type AclTab = "groups" | "rules" | "users";

// -- Tree helpers -------------------------------------------------

/** Returns a set of channel IDs whose subtree contains a match. */
function filterTree(nodes: TreeNode[], query: string): Set<number> {
  const matched = new Set<number>();
  const lq = query.toLowerCase();
  function walk(node: TreeNode): boolean {
    const selfMatch = node.channel.name.toLowerCase().includes(lq);
    let childMatch = false;
    for (const child of node.children) {
      if (walk(child)) childMatch = true;
    }
    if (selfMatch || childMatch) {
      matched.add(node.channel.id);
      return true;
    }
    return false;
  }
  for (const n of nodes) walk(n);
  return matched;
}

// -- Main component -----------------------------------------------

export function ChannelAclTab() {
  const channels = useAppStore((s) => s.channels);
  const users = useAppStore((s) => s.users);
  const deleteChannel = useAppStore((s) => s.deleteChannel);
  const { t } = useTranslation("settings");
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [aclData, setAclData] = useState<AclData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<AclTab>("rules");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [registeredNames, setRegisteredNames] = useState<Map<number, string>>(new Map());
  // Right-click context menu for a tree node (`confirming` = delete confirmation).
  const [menu, setMenu] = useState<
    { x: number; y: number; channel: ChannelEntry; confirming?: boolean } | null
  >(null);

  const tree = useMemo(() => buildChannelTree(channels), [channels]);
  const matchedIds = useMemo(
    () => (search ? filterTree(tree, search) : null),
    [tree, search],
  );

  // Auto-expand root on first render.
  useEffect(() => {
    if (tree.length > 0 && expanded.size === 0) {
      setExpanded(new Set([tree[0].channel.id]));
    }
  }, [tree, expanded.size]);

  // Fetch registered user names for ID resolution.
  useEffect(() => {
    const unlisten = listen<RegisteredUser[]>("user-list", (event) => {
      const map = new Map<number, string>();
      for (const u of event.payload) {
        map.set(u.user_id, u.name);
      }
      setRegisteredNames(map);
    });
    acquireRegisteredTextures();
    invoke("request_user_list").catch(() => {});
    return () => {
      unlisten.then((f) => f());
      releaseRegisteredTextures();
    };
  }, []);

  // Listen for ACL events from the backend.
  useEffect(() => {
    const unlisten = listen<AclData>("acl", (event) => {
      setAclData(event.payload);
      setLoading(false);
      setDirty(false);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const handleChannelSelect = useCallback((channelId: number) => {
    setSelectedChannel(channelId);
    setLoading(true);
    setAclData(null);
    invoke("request_acl", { channelId }).catch(() => setLoading(false));
  }, []);

  // Deep-link support: ?channel=<id> selects the channel and expands
  // every ancestor in the tree so it is visible.  Consumed once and
  // then stripped from the URL so back/refresh does not re-trigger.
  const channelParam = searchParams.get("channel");
  const consumedChannelParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!channelParam) return;
    if (consumedChannelParamRef.current === channelParam) return;
    if (channels.length === 0) return;
    const targetId = Number.parseInt(channelParam, 10);
    if (!Number.isFinite(targetId)) {
      consumedChannelParamRef.current = channelParam;
      return;
    }
    const target = channels.find((c) => c.id === targetId);
    if (!target) return;
    consumedChannelParamRef.current = channelParam;

    // Walk parent chain to collect ancestors that need expanding.
    const ancestors = new Set<number>();
    const byId = new Map(channels.map((c) => [c.id, c]));
    let cur: ChannelEntry | undefined = target;
    let guard = 0;
    while (cur && guard++ < 256) {
      ancestors.add(cur.id);
      const pid = cur.parent_id;
      if (pid == null || pid === cur.id) break;
      cur = byId.get(pid);
    }
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    handleChannelSelect(targetId);

    // Strip the consumed param so it does not re-fire on rerenders.
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp);
      next.delete("channel");
      return next;
    }, { replace: true });
  }, [channelParam, channels, handleChannelSelect, setSearchParams]);

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: MouseEvent, channel: ChannelEntry) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, channel });
  }, []);

  const handleDeleteChannel = useCallback(
    async (channel: ChannelEntry) => {
      setMenu(null);
      try {
        await deleteChannel(channel.id);
        if (selectedChannel === channel.id) {
          setSelectedChannel(null);
          setAclData(null);
        }
      } catch (err) {
        console.error("Failed to delete channel:", err);
      }
    },
    [deleteChannel, selectedChannel],
  );

  // -- ACL data mutations --

  const handleToggleInherit = useCallback(() => {
    if (!aclData) return;
    setAclData({ ...aclData, inherit_acls: !aclData.inherit_acls });
    setDirty(true);
  }, [aclData]);

  const patchGroup = useCallback(
    (idx: number, patch: Partial<AclGroup>) => {
      if (!aclData) return;
      const groups = aclData.groups.map((g, i) => (i === idx ? { ...g, ...patch } : g));
      setAclData({ ...aclData, groups });
      setDirty(true);
    },
    [aclData],
  );

  const addGroup = useCallback(() => {
    if (!aclData) return;
    const newGroup: AclGroup = {
      name: "new_group",
      inherited: false,
      inherit: true,
      inheritable: true,
      add: [],
      remove: [],
      inherited_members: [],
    };
    setAclData({ ...aclData, groups: [...aclData.groups, newGroup] });
    setDirty(true);
  }, [aclData]);

  const removeGroup = useCallback(
    (idx: number) => {
      if (!aclData) return;
      setAclData({ ...aclData, groups: aclData.groups.filter((_, i) => i !== idx) });
      setDirty(true);
    },
    [aclData],
  );

  const patchAcl = useCallback(
    (idx: number, patch: Partial<AclEntry>) => {
      if (!aclData) return;
      const acls = aclData.acls.map((a, i) => (i === idx ? { ...a, ...patch } : a));
      setAclData({ ...aclData, acls });
      setDirty(true);
    },
    [aclData],
  );

  const addAcl = useCallback(() => {
    if (!aclData) return;
    const newAcl: AclEntry = {
      apply_here: true,
      apply_subs: true,
      inherited: false,
      user_id: null,
      group: "all",
      grant: 0,
      deny: 0,
    };
    setAclData({ ...aclData, acls: [...aclData.acls, newAcl] });
    setDirty(true);
  }, [aclData]);

  const removeAcl = useCallback(
    (idx: number) => {
      if (!aclData) return;
      setAclData({ ...aclData, acls: aclData.acls.filter((_, i) => i !== idx) });
      setDirty(true);
    },
    [aclData],
  );

  const togglePermBit = useCallback(
    (aclIdx: number, field: "grant" | "deny", bit: number) => {
      if (!aclData) return;
      const entry = aclData.acls[aclIdx];
      patchAcl(aclIdx, { [field]: entry[field] ^ bit });
    },
    [aclData, patchAcl],
  );

  const handleSave = useCallback(async () => {
    if (!aclData) return;
    try {
      await invoke("update_acl", { acl: aclData });
      setDirty(false);
    } catch (err) {
      console.error("Failed to update ACL:", err);
    }
  }, [aclData]);

  const selectedName = channels.find((c) => c.id === selectedChannel)?.name ?? "";

  // Number of registered users explicitly granted Enter access (shown on the
  // Users tab badge); deny entries cancel a grant.
  const accessUserCount = useMemo(() => {
    if (!aclData) return 0;
    const granted = new Set<number>();
    for (const a of aclData.acls) {
      if (a.user_id == null) continue;
      if ((a.deny & PERM_ENTER) !== 0) granted.delete(a.user_id);
      else if ((a.grant & PERM_ENTER) !== 0) granted.add(a.user_id);
    }
    return granted.size;
  }, [aclData]);

  return (
    <>
      <h2 className={styles.panelTitle}>{t("channelAcl.title")}</h2>

      <div className={styles.aclSplitView}>
        {/* Left: Channel tree */}
        <div className={styles.aclTreePane}>
          <div className={styles.aclTreeSearch}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder={t("channelAcl.searchChannels")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => setSearch("")}
              >
                &times;
              </button>
            )}
          </div>
          <div className={styles.aclTreeList}>
            {tree.map((node) => (
              <ChannelTreeNode
                key={node.channel.id}
                node={node}
                depth={0}
                selected={selectedChannel}
                expanded={expanded}
                matchedIds={matchedIds}
                onSelect={handleChannelSelect}
                onToggle={toggleExpand}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        </div>

        {/* Right: ACL detail */}
        <div className={styles.aclDetailPane}>
          {selectedChannel === null && !loading && (
            <div className={styles.detailEmpty}>{t("channelAcl.selectChannel")}</div>
          )}
          {loading && <div className={styles.detailEmpty}>{t("channelAcl.loadingAcl")}</div>}

          {aclData && !loading && (
            <>
              <div className={styles.aclDetailHeader}>
                <h3 className={styles.aclDetailTitle}>{selectedName}</h3>
                {dirty && (
                  <button type="button" className={styles.saveBtn} onClick={handleSave}>
                    {t("channelAcl.saveChanges")}
                  </button>
                )}
              </div>

              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={aclData.inherit_acls}
                  onChange={handleToggleInherit}
                />
                {t("channelAcl.inheritAcls")}
              </label>

              {/* Tab switcher */}
              <div className={styles.aclTabs}>
                <button
                  type="button"
                  className={`${styles.aclTabBtn} ${activeTab === "rules" ? styles.aclTabActive : ""}`}
                  onClick={() => setActiveTab("rules")}
                >
                  {t("channelAcl.tabRules", { count: aclData.acls.length })}
                </button>
                <button
                  type="button"
                  className={`${styles.aclTabBtn} ${activeTab === "groups" ? styles.aclTabActive : ""}`}
                  onClick={() => setActiveTab("groups")}
                >
                  {t("channelAcl.tabGroups", { count: aclData.groups.length })}
                </button>
                <button
                  type="button"
                  className={`${styles.aclTabBtn} ${activeTab === "users" ? styles.aclTabActive : ""}`}
                  onClick={() => setActiveTab("users")}
                >
                  {t("channelAcl.tabUsers", { count: accessUserCount })}
                </button>
              </div>

              {/* Tab content */}
              <div className={styles.aclTabContent}>
                {activeTab === "rules" && (
                  <AclRulesPanel
                    acls={aclData.acls}
                    onAdd={addAcl}
                    onRemove={removeAcl}
                    onPatch={patchAcl}
                    onToggleBit={togglePermBit}
                  />
                )}
                {activeTab === "groups" && (
                  <GroupsPanel
                    groups={aclData.groups}
                    users={users}
                    registeredNames={registeredNames}
                    onAdd={addGroup}
                    onRemove={removeGroup}
                    onPatch={patchGroup}
                  />
                )}
                {activeTab === "users" && (
                  <AccessUsersPanel
                    acls={aclData.acls}
                    groups={aclData.groups}
                    users={users}
                    registeredNames={registeredNames}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Channel context menu (right-click in the tree) */}
      {menu && (
        <>
          <button
            type="button"
            className={styles.ctxBackdrop}
            aria-label={t("channelAcl.closeMenu", { defaultValue: "Close menu" })}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
          />
          <div className={styles.ctxMenu} style={{ top: menu.y, left: menu.x }} role="menu">
            {menu.confirming ? (
              <div className={styles.ctxConfirm}>
                <span className={styles.ctxConfirmText}>
                  {t("channelAcl.confirmDeleteChannel", { name: menu.channel.name })}
                </span>
                <div className={styles.ctxConfirmRow}>
                  <button
                    type="button"
                    className={styles.ctxDangerBtn}
                    data-testid={TID.aclDeleteConfirm}
                    onClick={() => { void handleDeleteChannel(menu.channel); }}
                  >
                    {t("channelAcl.deleteChannel")}
                  </button>
                  <button
                    type="button"
                    className={styles.ctxCancelBtn}
                    onClick={() => setMenu(null)}
                  >
                    {t("channelAcl.cancelDelete", { defaultValue: "Cancel" })}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={`${styles.ctxMenuItem} ${styles.ctxMenuItemDanger}`}
                data-testid={TID.aclDeleteChannel}
                onClick={() => setMenu((m) => (m ? { ...m, confirming: true } : m))}
              >
                <TrashIcon width={14} height={14} />
                {t("channelAcl.deleteChannel")}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

// -- Channel tree node --------------------------------------------

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
  onContextMenu: (e: MouseEvent, channel: ChannelEntry) => void;
}>) {
  const { t } = useTranslation("settings");
  const id = node.channel.id;
  const isExpanded = expanded.has(id);
  const hasChildren = node.children.length > 0;
  const isSelected = selected === id;
  const isPrivate = node.channel.detached === true;

  // If filtering and this node isn't in matched set, hide it.
  if (matchedIds && !matchedIds.has(id)) return null;

  return (
    <>
      <button
        type="button"
        className={`${styles.aclTreeItem} ${isSelected ? styles.aclTreeItemActive : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        data-testid={TID.aclChannelItem}
        data-channel-id={id}
        data-channel-name={node.channel.name}
        data-private={isPrivate ? "true" : undefined}
        onClick={() => onSelect(id)}
        onContextMenu={(e) => onContextMenu(e, node.channel)}
      >
        {hasChildren && (
          <span
            className={styles.aclTreeChevron}
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onToggle(id); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onToggle(id); } }}
          >
            <ChevronRightIcon
              width={12}
              height={12}
              style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
            />
          </span>
        )}
        {!hasChildren && <span className={styles.aclTreeChevronSpacer} />}
        {isPrivate && <LockIcon className={styles.aclTreePrivateIcon} width={11} height={11} />}
        <span className={styles.aclTreeLabel}>{node.channel.name}</span>
        {isPrivate && (
          <span className={styles.aclTreePrivateBadge}>
            {t("channelAcl.privateBadge")}
          </span>
        )}
      </button>
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
