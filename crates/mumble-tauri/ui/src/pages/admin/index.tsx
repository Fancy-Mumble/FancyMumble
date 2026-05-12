import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TabbedPage, type TabDef } from "../../components/elements/TabbedPage";
import { useAppStore } from "../../store";
import { RegisteredUsersTab } from "./RegisteredUsersTab";
import { BanListTab } from "./BanListTab";
import { ChannelAclTab } from "./ChannelAclTab";
import { RolesListPanel } from "./RolesListPanel";
import { CustomEmotesTab } from "./CustomEmotesTab";
import OnboardingAdminPanel from "../../components/onboarding/OnboardingAdminPanel";
import { isOnboardingSupported } from "../../components/onboarding/onboardingStore";
import { PERM_MANAGE_EMOTES } from "../../utils/permissions";
import styles from "./AdminPanel.module.css";

type Tab = "users" | "roles" | "bans" | "acl" | "emotes" | "onboarding";

const BASE_TABS: TabDef<Tab>[] = [
  { id: "users", label: "Users", icon: "\uD83D\uDC65" },
  { id: "roles", label: "Roles", icon: "\uD83C\uDFAD" },
  { id: "bans", label: "Ban List", icon: "\uD83D\uDEAB" },
  { id: "acl", label: "Channel ACL", icon: "\uD83D\uDD12" },
];

export default function AdminPanel() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("users");
  const customEmotesSupported = useAppStore((s) => s.fileServerCapabilities?.features.custom_emotes ?? false);
  const rootChannelPerms = useAppStore((s) => s.channels.find((c) => c.id === 0)?.permissions ?? 0);
  const canManageEmotes = customEmotesSupported && (rootChannelPerms & PERM_MANAGE_EMOTES) !== 0;
  const serverFancyVersion = useAppStore((s) => s.serverFancyVersion);
  const onboardingSupported = isOnboardingSupported(serverFancyVersion);
  const tabs: TabDef<Tab>[] = [
    ...BASE_TABS,
    ...(canManageEmotes
      ? [{ id: "emotes" as const, label: "Emotes", icon: "\uD83C\uDFA8" }]
      : []),
    ...(onboardingSupported
      ? [{ id: "onboarding" as const, label: "Onboarding", icon: "\uD83D\uDC4B" }]
      : []),
  ];

  return (
    <TabbedPage
      heading="Admin"
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      onBack={() => navigate("/chat")}
    >
      <div className={styles.content}>
        {tab === "users" && <RegisteredUsersTab />}
        {tab === "roles" && <RolesListPanel />}
        {tab === "bans" && <BanListTab />}
        {tab === "acl" && <ChannelAclTab />}
        {tab === "emotes" && <CustomEmotesTab />}
        {tab === "onboarding" && <OnboardingAdminPanel />}
      </div>
    </TabbedPage>
  );
}
