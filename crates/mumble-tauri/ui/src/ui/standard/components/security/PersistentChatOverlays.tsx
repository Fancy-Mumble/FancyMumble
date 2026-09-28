import { KeyIcon, WarningIcon } from "../../icons";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import type { KeyTrustLevel, PendingKeyShareRequest, PersistenceMode, UserMode } from "@core/types";
import { getPreferences } from "@core/preferencesStorage";
import { PERM_KEY_OWNER } from "@core/utils/permissions";
import { hasPermission } from "../sidebar/channel/ChannelEditorDialog";
import { TID } from "@core/testids";
import PersistenceBanner from "./PersistenceBanner";
import { InfoBanner } from "./InfoBanner";
import infoBannerStyles from "./InfoBanner.module.css";
import KeyVerificationDialog from "./KeyVerificationDialog";
import CustodianPrompt from "./CustodianPrompt";
import KeyShareWarningDialog from "./KeyShareWarningDialog";
import ConfirmDialog from "../elements/ConfirmDialog";
interface PersistentChatResult {
  trustLevel: KeyTrustLevel | undefined;
  onVerifyClick: (() => void) | undefined;
  isPersisted: boolean;
  banner: ReactNode;
  disputeBanner: ReactNode;
  keyShareBanner: ReactNode;
  revokedBanner: ReactNode;
  signalBridgeErrorBanner: ReactNode;
  keyRevoked: boolean;
  /** True when the user cannot send messages (key revoked or Signal bridge unavailable). */
  sendBlocked: boolean;
  dialogs: ReactNode;
}

const keyIcon = <KeyIcon aria-hidden="true" />;

const warningIcon = <WarningIcon aria-hidden="true" />;

function buildKeyShareBanner(
  channelId: number | null,
  requests: PendingKeyShareRequest[],
  onShareClick: (peerCertHash: string, peerName: string) => void,
  onDismiss: (channelId: number, hash: string) => void,
  t: (key: string) => string,
): ReactNode {
  if (channelId === null || requests.length === 0) return null;
  return (
    <>
      {requests.map((req) => (
        <InfoBanner
          key={req.peer_cert_hash}
          variant="glass"
          icon={keyIcon}
          actions={
            <button
              className={infoBannerStyles.approveButton}
              onClick={() => onShareClick(req.peer_cert_hash, req.peer_name)}
            >
              {t("overlays.shareKey")}
            </button>
          }
          onDismiss={() => onDismiss(channelId, req.peer_cert_hash)}
        >
          <p className={infoBannerStyles.description}>
            <strong>{req.peer_name}</strong> {t("overlays.joinedNeedsKey")}
          </p>
        </InfoBanner>
      ))}
    </>
  );
}

function buildDisputeBanner(onCompareClick: () => void, t: (key: string) => string): ReactNode {
  return (
    <InfoBanner
      variant="danger"
      icon={warningIcon}
      actions={
        <button className={infoBannerStyles.dangerAction} onClick={onCompareClick}>
          {t("overlays.compareFingerprints")}
        </button>
      }
    >
      <p className={infoBannerStyles.description}>{t("overlays.conflictingKeys")}</p>
    </InfoBanner>
  );
}

/**
 * Hook encapsulating persistent-chat UI state: persistence banner,
 * key verification dialog, and custodian prompt.
 * Extracted from ChatView to reduce component complexity.
 */
export function usePersistentChat(channelId: number | null, channelName: string): PersistentChatResult {
  const channelPersistence = useAppStore((s) => s.channelPersistence);
  const pchatHistoryLoading = useAppStore((s) => s.pchatHistoryLoading);
  const keyTrust = useAppStore((s) => s.keyTrust);
  const custodianPins = useAppStore((s) => s.custodianPins);
  const pendingDisputes = useAppStore((s) => s.pendingDisputes);
  const verifyKeyFingerprint = useAppStore((s) => s.verifyKeyFingerprint);
  const acceptCustodianChanges = useAppStore((s) => s.acceptCustodianChanges);
  const confirmCustodians = useAppStore((s) => s.confirmCustodians);
  const pendingKeyShares = useAppStore((s) => s.pendingKeyShares);
  const approveKeyShare = useAppStore((s) => s.approveKeyShare);
  const dismissKeyShare = useAppStore((s) => s.dismissKeyShare);
  const pchatKeyRevoked = useAppStore((s) => s.pchatKeyRevoked);
  const signalBridgeError = useAppStore((s) => s.signalBridgeError);
  const channels = useAppStore((s) => s.channels);

  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const [showCustodianPrompt, setShowCustodianPrompt] = useState(false);
  const [keyShareConfirm, setKeyShareConfirm] = useState<{ hash: string; name: string } | null>(null);
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const [userMode, setUserMode] = useState<UserMode>("normal");
  const { t } = useTranslation("sidebar");
  const tStr = t as (k: string) => string;

  useEffect(() => {
    getPreferences().then((p) => setUserMode(p.userMode));
  }, []);

  const persistence = channelId === null ? undefined : channelPersistence[channelId];
  const isLoading = channelId !== null && pchatHistoryLoading.has(channelId);
  const trust = channelId === null ? undefined : keyTrust[channelId];
  const custodian = channelId === null ? undefined : custodianPins[channelId];
  const dispute = channelId === null ? undefined : pendingDisputes[channelId];
  const keyRevoked = channelId !== null && pchatKeyRevoked.has(channelId);
  const persistenceMode: PersistenceMode = persistence?.mode ?? "NONE";

  // A KeyOwner admin can un-brick a channel whose key challenge failed by
  // taking over key ownership (fresh key, keeps the stored - now
  // unreadable - history). Without this the failure banner was a dead end
  // even for the one user able to recover the channel.
  const channel = channelId === null ? undefined : channels.find((c) => c.id === channelId);
  const canTakeover = keyRevoked && hasPermission(channel, PERM_KEY_OWNER);

  const handleTakeover = useCallback(() => {
    setConfirmTakeover(false);
    if (channelId !== null) {
      invoke("key_takeover", { channelId, mode: "key_only" }).catch((e: unknown) =>
        console.error("key_takeover failed:", e),
      );
    }
  }, [channelId]);

  const handleShareClick = useCallback((peerCertHash: string, peerName: string) => {
    setKeyShareConfirm({ hash: peerCertHash, name: peerName });
  }, []);

  const handleShareConfirm = useCallback(() => {
    if (channelId !== null && keyShareConfirm) {
      approveKeyShare(channelId, keyShareConfirm.hash);
    }
    setKeyShareConfirm(null);
  }, [channelId, keyShareConfirm, approveKeyShare]);

  // Auto-show custodian prompt when unconfirmed or pending changes detected.
  useEffect(() => {
    if (!custodian) return;
    if (!custodian.confirmed || custodian.pendingUpdate) {
      setShowCustodianPrompt(true);
    }
  }, [custodian]);

  const showBanner = channelId !== null && ((persistence && persistence.mode !== "NONE") || isLoading);

  const keyShareRequests = (channelId !== null && pendingKeyShares[channelId]) || [];

  return {
    trustLevel: trust?.trustLevel,
    onVerifyClick: trust ? () => setShowVerifyDialog(true) : undefined,
    isPersisted: !!persistence && persistence.mode !== "NONE",
    banner: showBanner ? <PersistenceBanner channelId={channelId} /> : null,
    disputeBanner: dispute ? buildDisputeBanner(() => setShowVerifyDialog(true), tStr) : null,
    keyShareBanner: keyRevoked
      ? null
      : buildKeyShareBanner(channelId, keyShareRequests, handleShareClick, dismissKeyShare, tStr),
    revokedBanner: keyRevoked ? (
      <InfoBanner
        variant="danger"
        icon={warningIcon}
        actions={
          canTakeover ? (
            <button
              className={infoBannerStyles.dangerAction}
              data-testid={TID.pchatResetKey}
              onClick={() => setConfirmTakeover(true)}
            >
              {t("overlays.resetChannelKey")}
            </button>
          ) : undefined
        }
      >
        {userMode === "normal" ? (
          <p className={infoBannerStyles.description}>{t("overlays.revokedNormal")}</p>
        ) : (
          <>
            <p className={infoBannerStyles.description}>
              <strong>{t("overlays.keyChallengeFailed")}</strong> - {t("overlays.keyRejected")}
            </p>
            <p className={infoBannerStyles.description}>{t("overlays.keyMaterialPurged")}</p>
          </>
        )}
      </InfoBanner>
    ) : null,
    keyRevoked,
    sendBlocked: keyRevoked || (persistenceMode === "SIGNAL_V1" && !!signalBridgeError),
    signalBridgeErrorBanner:
      persistenceMode === "SIGNAL_V1" && signalBridgeError ? (
        <InfoBanner variant="danger" icon={warningIcon}>
          <p className={infoBannerStyles.description}>
            <strong>{t("overlays.encryptionUnavailable")}</strong> - {signalBridgeError}
          </p>
          <p className={infoBannerStyles.description}>{t("overlays.encryptionUnavailableDetail")}</p>
        </InfoBanner>
      ) : null,
    dialogs: (
      <>
        {trust && channelId !== null && (
          <KeyVerificationDialog
            channelId={channelId}
            open={showVerifyDialog}
            onClose={() => setShowVerifyDialog(false)}
            onVerify={() => verifyKeyFingerprint(channelId)}
            trustLevel={trust.trustLevel}
            channelName={channelName}
            mode={persistence?.mode ?? "NONE"}
            distributorName={trust.distributorName}
            distributorHash={trust.distributorHash}
          />
        )}
        {custodian && channelId !== null && (
          <CustodianPrompt
            open={showCustodianPrompt}
            onClose={() => setShowCustodianPrompt(false)}
            onConfirm={() =>
              custodian.pendingUpdate ? acceptCustodianChanges(channelId) : confirmCustodians(channelId)
            }
            custodians={custodian.pinned.map((h) => ({ hash: h }))}
            isFirstJoin={!custodian.confirmed && !custodian.pendingUpdate}
            addedCustodians={custodian.pendingUpdate
              ?.filter((h) => !custodian.pinned.includes(h))
              .map((h) => ({ hash: h }))}
            removedCustodians={
              custodian.pendingUpdate
                ? custodian.pinned
                    .filter((h) => {
                      const pending = custodian.pendingUpdate;
                      return pending ? !pending.includes(h) : false;
                    })
                    .map((h) => ({ hash: h }))
                : undefined
            }
          />
        )}
        <KeyShareWarningDialog
          open={keyShareConfirm !== null}
          peerName={keyShareConfirm?.name ?? ""}
          persistenceMode={persistenceMode}
          totalStored={persistence?.totalStored ?? 0}
          onConfirm={handleShareConfirm}
          onCancel={() => setKeyShareConfirm(null)}
        />
        {confirmTakeover && channelId !== null && (
          <ConfirmDialog
            title={t("overlays.resetChannelKeyTitle")}
            body={t("overlays.resetChannelKeyBody", { channel: channelName })}
            confirmLabel={t("overlays.resetChannelKeyConfirm")}
            danger
            onConfirm={handleTakeover}
            onCancel={() => setConfirmTakeover(false)}
          />
        )}
      </>
    ),
  };
}
