import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { acquireRegisteredTextures, releaseRegisteredTextures } from "@core/registeredTextureLease";
import { listen } from "@tauri-apps/api/event";
import { useNavigate, useParams } from "react-router-dom";
import { useAppStore } from "@core/store";
import { TabbedPage, type TabDef } from "../../components/elements/TabbedPage";
import { PaletteIcon, LockIcon, UsersGroupIcon } from "../../icons";
import type { AclGroup, RegisteredUser } from "@core/types";
import { TID } from "@core/testids";
import { useChannelAcl } from "@core/features/admin/useChannelAcl";
import { rootChannelId } from "@core/features/admin/rootChannel";
import { RoleDisplayPanel } from "./RoleDisplayPanel";
import { RolePermissionsPanel } from "./RolePermissionsPanel";
import { RoleMembersPanel } from "./RoleMembersPanel";
import styles from "./AdminPanel.module.css";
import tabStyles from "../../components/elements/TabbedPage.module.css";

type SubTab = "display" | "permissions" | "members";

export default function RoleEditorPage() {
  const { groupName: encodedName = "" } = useParams<{ groupName: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  const channels = useAppStore((s) => s.channels);
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  const { acl, loading, dirty, saving, setAcl, save } = useChannelAcl(rootId);
  const [tab, setTab] = useState<SubTab>("display");
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);

  // Listener before request: a fast server's answer can beat an un-awaited
  // listen() registration and Tauri does not replay events - the Members
  // panel's user picker would then stay empty.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    acquireRegisteredTextures();
    (async () => {
      const un = await listen<RegisteredUser[]>("user-list", (e) => setRegisteredUsers(e.payload));
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      invoke("request_user_list").catch(() => {});
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      releaseRegisteredTextures();
    };
  }, []);

  const roleName = decodeURIComponent(encodedName);
  const roleIdx = useMemo(() => acl?.groups.findIndex((g) => g.name === roleName) ?? -1, [acl, roleName]);
  const role: AclGroup | null = roleIdx === -1 ? null : (acl?.groups[roleIdx] ?? null);

  const subTabs: TabDef<SubTab>[] = [
    { id: "display", label: t("roleEditor.tabDisplay"), icon: <PaletteIcon width={16} height={16} /> },
    { id: "permissions", label: t("roleEditor.tabPermissions"), icon: <LockIcon width={16} height={16} /> },
    { id: "members", label: t("roleEditor.tabMembers"), icon: <UsersGroupIcon width={16} height={16} /> },
  ];

  const patchRole = (patch: Partial<AclGroup>) => {
    if (!acl || roleIdx === -1) return;
    const groups = acl.groups.map((g, i) => (i === roleIdx ? { ...g, ...patch } : g));
    setAcl({ ...acl, groups });
  };

  const handleDelete = async () => {
    if (!acl || roleIdx === -1) return;
    const next = { ...acl, groups: acl.groups.filter((_, i) => i !== roleIdx) };
    setAcl(next);
    await save(next);
    navigate("/admin?tab=roles");
  };

  let body: React.ReactNode;
  if (loading && !acl) {
    body = <div className={styles.dimText}>{t("roleEditor.loadingRole")}</div>;
  } else if (!role) {
    body = (
      <div className={styles.dimText} data-testid={TID.roleEditorNotFound} data-role-name={roleName}>
        {t("roleEditor.notFound", { name: roleName })}
      </div>
    );
  } else if (tab === "display") {
    body = <RoleDisplayPanel role={role} onPatch={patchRole} />;
  } else if (tab === "permissions" && acl) {
    body = <RolePermissionsPanel acl={acl} roleName={role.name} onAclChange={setAcl} />;
  } else {
    body = <RoleMembersPanel role={role} onPatch={patchRole} registeredUsers={registeredUsers} />;
  }

  const canDelete = role != null && !role.inherited;
  const footer =
    canDelete || dirty ? (
      <>
        {canDelete && (
          <button
            type="button"
            className={`${tabStyles.actionBtn} ${tabStyles.actionBtnDanger}`}
            onClick={handleDelete}
            disabled={saving}
          >
            {t("roleEditor.deleteRole")}
          </button>
        )}
        <div className={tabStyles.actionBtnGroup}>
          {dirty && (
            <button
              type="button"
              className={`${tabStyles.actionBtn} ${tabStyles.actionBtnPrimary}`}
              onClick={() => save()}
              disabled={saving}
            >
              {saving ? t("roleEditor.saving") : t("roleEditor.saveChanges")}
            </button>
          )}
        </div>
      </>
    ) : undefined;

  return (
    <TabbedPage
      heading={t("roleEditor.headingPrefix", { name: roleName })}
      tabs={subTabs}
      activeTab={tab}
      onTabChange={setTab}
      onBack={() => navigate("/admin?tab=roles")}
      footer={footer}
    >
      <div className={styles.content}>{body}</div>
    </TabbedPage>
  );
}
