/**
 * The "Server features" list, read from the store and put into words.
 *
 * The same split as the rest of this folder: `@core/features/server` decides
 * what the answers are, this turns them into rows, and each pack draws them.
 * Standard and Nebula both list the same twelve features in the same order.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { PLUGIN_NAME_CALENDAR, PLUGIN_NAME_LIVE_DOC } from "@core/constants/pluginData";
import {
  describeServerFeatures,
  type FeatureEvidence,
  type FeatureSupport,
  type ServerFeatureId,
} from "@core/features/server/serverFeatures";

export type { FeatureSupport, ServerFeatureId };

/** One line of the list: what the feature is, and what this server says. */
export interface ServerFeatureRow {
  readonly id: ServerFeatureId;
  readonly label: string;
  readonly support: FeatureSupport;
  /** The answer, with its evidence when there is any: "Yes · epoch 1". */
  readonly value: string;
}

/**
 * Which version of a server plugin is loaded, or null when it is not.
 *
 * The registry is the live truth - it is re-broadcast on every enable and
 * disable - and the advertised infos are only sent once on connect. A server
 * that sends no registry at all still sends those, so they are the fallback
 * rather than the first answer.
 */
function loadedPluginVersion(
  name: string,
  registry: readonly { pluginName: string; version: string }[],
  infos: ReadonlyMap<string, { version: string }>,
): string | null {
  if (registry.length > 0) {
    return registry.find((entry) => entry.pluginName === name)?.version ?? null;
  }
  return infos.get(name)?.version ?? null;
}

export function useServerFeatures(): readonly ServerFeatureRow[] {
  const { t } = useTranslation("server");
  const fancyVersion = useAppStore((s) => s.serverFancyVersion);
  const fancyProtocol = useAppStore((s) => s.serverFancyProtocol);
  const hostAbiVersion = useAppStore((s) => s.serverHostAbiVersion);
  const sfuAvailable = useAppStore((s) => s.serverConfig.webrtc_sfu_available);
  const allowHtml = useAppStore((s) => s.serverConfig.allow_html);
  const fileService = useAppStore((s) => s.fileServerKind);
  const fileCapabilities = useAppStore((s) => s.fileServerCapabilities);
  const liveDocConfig = useAppStore((s) => s.liveDocPluginConfig);
  const pluginRegistry = useAppStore((s) => s.pluginRegistry);
  const pluginInfos = useAppStore((s) => s.pluginInfos);
  const channelPersistence = useAppStore((s) => s.channelPersistence);

  const features = useMemo(
    () =>
      describeServerFeatures({
        fancyVersion,
        fancyProtocol,
        sfuAvailable,
        allowHtml,
        fileService,
        fileServerPlugin: fileCapabilities?.plugin ?? null,
        customEmotes: fileCapabilities?.features.custom_emotes ?? null,
        liveDocVersion:
          liveDocConfig?.version ?? loadedPluginVersion(PLUGIN_NAME_LIVE_DOC, pluginRegistry, pluginInfos),
        calendarVersion: loadedPluginVersion(PLUGIN_NAME_CALENDAR, pluginRegistry, pluginInfos),
        persistentChannels: Object.values(channelPersistence).filter((p) => p.mode !== "NONE").length,
        hostAbiVersion,
      }),
    [
      allowHtml,
      channelPersistence,
      fancyProtocol,
      fancyVersion,
      fileCapabilities,
      fileService,
      hostAbiVersion,
      liveDocConfig,
      pluginInfos,
      pluginRegistry,
      sfuAvailable,
    ],
  );

  return useMemo(() => {
    // The key paths are built from the ids, and the catalogue is typed against
    // the English JSON: the casts name a sibling key so the lookup still has to
    // exist, the way the admin nav's labels do.
    const evidenceText = (evidence: FeatureEvidence): string => {
      switch (evidence.kind) {
        case "text":
          return evidence.text;
        case "channels":
          return t("infoPanel.features.notes.channelCount", { count: evidence.count });
        case "phrase":
          return t(`infoPanel.features.notes.${evidence.phrase}` as "infoPanel.features.notes.canonService");
      }
    };

    return features.map((feature) => {
      const state = t(`infoPanel.features.state.${feature.support}` as "infoPanel.features.state.yes");
      return {
        id: feature.id,
        label: t(`infoPanel.features.names.${feature.id}` as "infoPanel.features.names.fancyExtensions"),
        support: feature.support,
        value: feature.evidence
          ? t("infoPanel.features.value", { state, detail: evidenceText(feature.evidence) })
          : state,
      };
    });
  }, [features, t]);
}
