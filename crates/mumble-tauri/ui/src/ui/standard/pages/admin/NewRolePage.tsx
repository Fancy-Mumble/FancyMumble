import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { acquireRegisteredTextures, releaseRegisteredTextures } from "@core/registeredTextureLease";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@core/store";
import { TabbedPage, type TabDef } from "../../components/elements/TabbedPage";
import { PaletteIcon, LockIcon, UsersGroupIcon } from "../../icons";
import type { AclData, AclEntry, AclGroup, RegisteredUser } from "@core/types";
import { TID } from "@core/testids";
import { useChannelAcl } from "@core/features/admin/useChannelAcl";
import { rootChannelId } from "@core/features/admin/rootChannel";
import { RoleDisplayPanel } from "./RoleDisplayPanel";
import { RolePermissionsPanel } from "./RolePermissionsPanel";
import { RoleMembersPanel } from "./RoleMembersPanel";
import styles from "./AdminPanel.module.css";
import tabStyles from "../../components/elements/TabbedPage.module.css";

type Step = "display" | "permissions" | "members";
const STEPS: readonly Step[] = ["display", "permissions", "members"];

/** Picks `new_role`, or `new_role_2`/`_3`/... if that's already taken. */
function draftName(existing: ReadonlySet<string>): string {
  const baseName = "new_role";
  let name = baseName;
  let suffix = 1;
  while (existing.has(name)) {
    suffix += 1;
    name = `${baseName}_${suffix}`;
  }
  return name;
}

function makeDraftGroup(existing: ReadonlySet<string>): AclGroup {
  return {
    name: draftName(existing),
    inherited: false,
    inherit: true,
    inheritable: true,
    add: [],
    remove: [],
    inherited_members: [],
    color: null,
    icon: null,
    style_preset: null,
    metadata: {},
  };
}

/**
 * Wizard for creating a new server role (`/admin/roles/new`), distinct from
 * {@link ../../pages/admin/RoleEditorPage} which edits an already-persisted
 * one. The draft group (and any permission-entry edits) live only in local
 * state - nothing is sent to the server until "Create role" on the final
 * step, so navigating away (Back/Cancel) cleanly discards it.
 */
export default function NewRolePage() {
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  const channels = useAppStore((s) => s.channels);
  const rootId = useMemo(() => rootChannelId(channels), [channels]);
  const { acl, loading, save } = useChannelAcl(rootId);

  const [step, setStep] = useState<Step>("display");
  const [draftGroup, setDraftGroup] = useState<AclGroup | null>(null);
  const [draftAcls, setDraftAcls] = useState<AclEntry[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);

  // Listener before request: a fast server's answer can beat an un-awaited
  // listen() registration and Tauri does not replay events - the Members
  // step's user picker would then stay empty.
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

  // Seed the draft once the ACL has loaded (need existing group names to
  // pick a non-clashing default name, and the existing ACL entries as the
  // base for the Permissions step).
  useEffect(() => {
    if (!acl || draftGroup) return;
    setDraftGroup(makeDraftGroup(new Set(acl.groups.map((g) => g.name))));
    setDraftAcls(acl.acls);
  }, [acl, draftGroup]);

  const patchDraft = (patch: Partial<AclGroup>) => {
    setDraftGroup((g) => (g ? { ...g, ...patch } : g));
  };

  // What RolePermissionsPanel edits against: the real ACL's entries swapped
  // for the draft's (possibly already-edited) copy, so toggling a permission
  // for the not-yet-created role works the same way it does for a real one.
  const previewAcl: AclData | null = useMemo(
    () => (acl && draftAcls ? { ...acl, acls: draftAcls } : null),
    [acl, draftAcls],
  );

  const stepIdx = STEPS.indexOf(step);
  const isFirstStep = stepIdx === 0;
  const isLastStep = stepIdx === STEPS.length - 1;

  const goBack = () => navigate("/admin?tab=roles");

  const handleCreate = async () => {
    if (!acl || !draftGroup || !draftAcls) return;
    setCreating(true);
    try {
      await save({ ...acl, groups: [...acl.groups, draftGroup], acls: draftAcls });
      navigate(`/admin/role/${encodeURIComponent(draftGroup.name)}`);
    } finally {
      setCreating(false);
    }
  };

  const tabs: TabDef<Step>[] = [
    { id: "display",     label: t("roleEditor.tabDisplay"),     icon: <PaletteIcon    width={16} height={16} /> },
    { id: "permissions", label: t("roleEditor.tabPermissions"), icon: <LockIcon       width={16} height={16} /> },
    { id: "members",     label: t("roleEditor.tabMembers"),     icon: <UsersGroupIcon width={16} height={16} /> },
  ];

  let body: React.ReactNode;
  if ((loading && !acl) || !draftGroup || !previewAcl) {
    body = <div className={styles.dimText}>{t("roleEditor.loadingRole")}</div>;
  } else if (step === "display") {
    body = <RoleDisplayPanel role={draftGroup} onPatch={patchDraft} disabled={creating} />;
  } else if (step === "permissions") {
    body = (
      <RolePermissionsPanel
        acl={previewAcl}
        roleName={draftGroup.name}
        onAclChange={(next) => setDraftAcls(next.acls)}
        disabled={creating}
      />
    );
  } else {
    body = (
      <RoleMembersPanel
        role={draftGroup}
        onPatch={patchDraft}
        registeredUsers={registeredUsers}
        disabled={creating}
      />
    );
  }

  const footer = (
    <>
      <button
        type="button"
        className={tabStyles.actionBtn}
        onClick={goBack}
        disabled={creating}
        data-testid={TID.roleWizardCancel}
      >
        {t("roleEditor.cancel")}
      </button>
      <div className={tabStyles.actionBtnGroup}>
        {!isFirstStep && (
          <button
            type="button"
            className={tabStyles.actionBtn}
            onClick={() => setStep(STEPS[stepIdx - 1])}
            disabled={creating}
            data-testid={TID.roleWizardPrev}
          >
            {t("roleEditor.previous")}
          </button>
        )}
        {!isLastStep && (
          <button
            type="button"
            className={`${tabStyles.actionBtn} ${tabStyles.actionBtnPrimary}`}
            onClick={() => setStep(STEPS[stepIdx + 1])}
            disabled={creating}
            data-testid={TID.roleWizardNext}
          >
            {t("roleEditor.next")}
          </button>
        )}
        {isLastStep && (
          <button
            type="button"
            className={`${tabStyles.actionBtn} ${tabStyles.actionBtnPrimary}`}
            onClick={handleCreate}
            disabled={creating || !draftGroup}
            data-testid={TID.roleWizardCreate}
          >
            {creating ? t("roleEditor.saving") : t("roleEditor.createRole")}
          </button>
        )}
      </div>
    </>
  );

  return (
    <TabbedPage
      heading={t("roleEditor.newHeadingPrefix", { name: draftGroup?.name ?? "" })}
      tabs={tabs}
      activeTab={step}
      onTabChange={setStep}
      onBack={goBack}
      footer={footer}
    >
      <div className={styles.content}>
        {body}
      </div>
    </TabbedPage>
  );
}
