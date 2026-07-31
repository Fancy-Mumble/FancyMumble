import styles from "../../AuroraClientSurfaces.module.css";
import { ModalSurface } from "../../components";
import { useChannelDescription } from "@core/lazyBlobs";
import { useAppStore } from "@core/store";
import type { ChannelEntry, ServerInfo } from "@core/types";
import { invoke } from "@tauri-apps/api/core";
import { InfoIcon } from "@ui/icons";
import { useEffect, useState } from "react";
import Fact from "../primitives/Fact";
import { plainText } from "../htmlText";

export function InfoPanel({
  kind,
  channel,
  onClose,
}: {
  kind: "server" | "channel";
  channel: ChannelEntry | null;
  onClose: () => void;
}) {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const active = useAppStore((state) =>
    state.sessions.find((session) => session.id === state.activeServerId),
  );
  const description = useChannelDescription(channel?.id, channel?.description_size);
  useEffect(() => {
    if (kind === "server")
      void invoke<ServerInfo>("get_server_info")
        .then(setServer)
        .catch(() => setServer(null));
  }, [kind]);
  return (
    <ModalSurface
      title={kind === "server" ? (active?.label ?? "Server information") : `#${channel?.name ?? "Channel"}`}
      eyebrow={kind === "server" ? "SERVER DETAILS" : "CHANNEL DETAILS"}
      onClose={onClose}
    >
      <div className={styles.infoHero}>
        <span>
          <InfoIcon />
        </span>
        <div>
          <h3>{kind === "server" ? (active?.label ?? server?.host) : channel?.name}</h3>
          <p>
            {kind === "server"
              ? `${server?.host ?? active?.host ?? ""}:${server?.port ?? active?.port ?? ""}`
              : plainText(description) || "No channel description has been set."}
          </p>
        </div>
      </div>
      <div className={styles.factGrid}>
        {kind === "server" ? (
          <>
            <Fact
              label="Users"
              value={`${server?.user_count ?? "—"}${server?.max_users ? ` / ${server.max_users}` : ""}`}
            />
            <Fact label="Version" value={server?.release ?? server?.protocol_version ?? "Unknown"} />
            <Fact label="Platform" value={server?.os ?? "Unknown"} />
            <Fact label="Codec" value={server?.opus ? "Opus" : "Legacy"} />
            <Fact label="Connection" value={active?.status ?? "Disconnected"} />
            <Fact label="Transport" value={useAppStore.getState().udpActive ? "UDP" : "TCP tunnel"} />
          </>
        ) : (
          <>
            <Fact label="Members" value={String(channel?.user_count ?? 0)} />
            <Fact label="Capacity" value={channel?.max_users ? String(channel.max_users) : "Unlimited"} />
            <Fact
              label="Persistent chat"
              value={channel?.pchat_protocol === "none" || !channel?.pchat_protocol ? "Off" : "Enabled"}
            />
            <Fact label="Temporary" value={channel?.temporary ? "Yes" : "No"} />
            <Fact label="Restricted" value={channel?.is_enter_restricted ? "Yes" : "No"} />
            <Fact
              label="Retention"
              value={channel?.pchat_retention_days ? `${channel.pchat_retention_days} days` : "Forever"}
            />
          </>
        )}
      </div>
    </ModalSurface>
  );
}
