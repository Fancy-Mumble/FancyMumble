// Orchestrator for plugin-driven UI surfaces.  Renders:
//   - ephemeral cards (buttons, selects, layout primitives, media)
//   - a single active modal dialog (typed-field form)
//   - plugin-emitted toasts
//   - the trust prompt for newly-discovered plugins
//
// Individual component rendering is delegated to:
//   - PluginComponentRenderer.tsx for non-modal contexts
//   - PluginModalForm.tsx       for modal contexts (owns typed state)

import { createPortal } from "react-dom";
import {
  dismissPluginCard,
  dismissPluginToast,
  useAppStore,
} from "../../store";
import Toast from "../elements/Toast";
import { CloseIcon } from "../../icons";
import type { ActionRow, ToastLevel } from "../../plugins/tier1/types";
import type {
  PluginMessageCard,
  PluginToastState,
} from "../../plugins/tier1/store";
import PluginTrustPrompt from "./PluginTrustPrompt";
import { RenderComponent } from "./PluginComponentRenderer";
import PluginModalForm from "./PluginModalForm";
import styles from "./PluginInteractionLayer.module.css";

/** Mounted once near the app root.  Renders every plugin-driven UI
 *  surface: ephemeral cards (buttons, select menus, rich layout),
 *  modal dialogs, and toasts. */
export default function PluginInteractionLayer() {
  const cards = useAppStore((s) => s.pluginCards);
  const modal = useAppStore((s) => s.pluginModal);
  const toasts = useAppStore((s) => s.pluginToasts);
  return (
    <>
      <PluginTrustPrompt />
      <CardStack cards={cards} />
      {modal && createPortal(<PluginModalForm modal={modal} />, document.body)}
      {toasts.map((t) => (
        <PluginToastSlot key={t.id} toast={t} />
      ))}
    </>
  );
}

function CardStack({ cards }: { readonly cards: readonly PluginMessageCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className={styles.cardStack}>
      {cards.map((c) => (
        <PluginCard key={c.id} card={c} />
      ))}
    </div>
  );
}

function PluginCard({ card }: { readonly card: PluginMessageCard }) {
  return (
    <div className={styles.card} role="dialog" aria-label={card.pluginName}>
      <div className={styles.cardHeader}>
        <span className={styles.cardPlugin}>{card.pluginName}</span>
        <button
          type="button"
          className={styles.cardClose}
          onClick={() => dismissPluginCard(card.messageId)}
          aria-label="Dismiss"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>
      {card.content && <div className={styles.cardBody}>{card.content}</div>}
      {card.components.map((row, i) => (
        <ComponentRow
          key={`${card.id}:${i}`}
          row={row}
          pluginName={card.pluginName}
          channelId={card.channelId}
        />
      ))}
    </div>
  );
}

function ComponentRow({
  row,
  pluginName,
  channelId,
}: {
  readonly row: ActionRow;
  readonly pluginName: string;
  readonly channelId: number | null;
}) {
  return (
    <div className={styles.componentRow}>
      {row.components.map((c, i) => (
        <RenderComponent
          key={`${pluginName}:${i}`}
          component={c}
          ctx={{ pluginName, channelId }}
        />
      ))}
    </div>
  );
}

function PluginToastSlot({ toast }: { readonly toast: PluginToastState }) {
  return (
    <Toast
      message={toast.message}
      variant={toastVariant(toast.level)}
      onDismiss={() => dismissPluginToast(toast.id)}
    />
  );
}

function toastVariant(level: ToastLevel): "success" | "error" | "info" {
  switch (level) {
    case "success":
      return "success";
    case "warning":
    case "error":
      return "error";
    case "info":
      return "info";
  }
}
