import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  dismissPluginCard,
  dismissPluginModal,
  dismissPluginToast,
  sendPluginInteraction,
  useAppStore,
} from "../../store";
import Toast from "../elements/Toast";
import { CloseIcon } from "../../icons";
import type {
  ActionRow,
  ButtonStyle,
  Component,
  ToastLevel,
} from "../../plugins/tier1/types";
import type {
  PluginMessageCard,
  PluginModalState,
  PluginToastState,
} from "../../plugins/tier1/store";
import PluginTrustPrompt from "./PluginTrustPrompt";
import styles from "./PluginInteractionLayer.module.css";

/** Mounted once near the app root.  Renders every plugin-driven UI
 *  surface: ephemeral cards (buttons, select menus), modal dialogs,
 *  and toasts. */
export default function PluginInteractionLayer() {
  const cards = useAppStore((s) => s.pluginCards);
  const modal = useAppStore((s) => s.pluginModal);
  const toasts = useAppStore((s) => s.pluginToasts);
  return (
    <>
      <PluginTrustPrompt />
      <CardStack cards={cards} />
      {modal && <PluginModal modal={modal} />}
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
          pluginName={pluginName}
          channelId={channelId}
        />
      ))}
    </div>
  );
}

function RenderComponent({
  component,
  pluginName,
  channelId,
}: {
  readonly component: Component;
  readonly pluginName: string;
  readonly channelId: number | null;
}) {
  switch (component.type) {
    case "button":
      return (
        <button
          type="button"
          className={`${styles.btn} ${btnClass(component.style)}`}
          disabled={component.disabled}
          onClick={() =>
            void sendPluginInteraction(
              pluginName,
              { kind: "component", custom_id: component.custom_id },
              channelId,
            )
          }
        >
          {component.label}
        </button>
      );
    case "select-menu":
      return (
        <select
          className={styles.select}
          defaultValue=""
          onChange={(e) =>
            void sendPluginInteraction(
              pluginName,
              {
                kind: "component",
                custom_id: component.custom_id,
                values: [e.target.value],
              },
              channelId,
            )
          }
        >
          <option value="" disabled>
            {component.placeholder ?? "Pick one"}
          </option>
          {component.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "text-input":
      // Text inputs only render inside modals; outside one they are a
      // schema error on the plugin side - silently skip.
      return null;
  }
}

function btnClass(style: ButtonStyle | undefined): string {
  switch (style) {
    case "secondary":
      return styles.btnSecondary;
    case "success":
      return styles.btnSuccess;
    case "danger":
      return styles.btnDanger;
    case "primary":
    case undefined:
      return styles.btnPrimary;
  }
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function PluginModal({ modal }: { readonly modal: PluginModalState }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(modal),
  );
  useEffect(() => {
    setValues(initialValues(modal));
  }, [modal]);

  const onSubmit = () => {
    void sendPluginInteraction(
      modal.pluginName,
      { kind: "modal-submit", custom_id: modal.customId, values },
      modal.channelId,
    );
    dismissPluginModal();
  };

  return createPortal(
    <div
      className={styles.modalScrim}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismissPluginModal();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span>{modal.title}</span>
          <button
            type="button"
            className={styles.cardClose}
            onClick={dismissPluginModal}
            aria-label="Close"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        <div className={styles.modalBody}>
          {modal.components.flatMap((row) =>
            row.components.map((c) => {
              if (c.type !== "text-input") return null;
              return (
                <ModalTextInput
                  key={c.custom_id}
                  component={c}
                  value={values[c.custom_id] ?? ""}
                  onChange={(next) =>
                    setValues((prev) => ({ ...prev, [c.custom_id]: next }))
                  }
                />
              );
            }),
          )}
        </div>
        <div className={styles.modalFooter}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnSecondary}`}
            onClick={dismissPluginModal}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onSubmit}
          >
            Submit
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function initialValues(modal: PluginModalState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of modal.components) {
    for (const c of row.components) {
      if (c.type === "text-input") out[c.custom_id] = c.value ?? "";
    }
  }
  return out;
}

function ModalTextInput({
  component,
  value,
  onChange,
}: {
  readonly component: Extract<Component, { type: "text-input" }>;
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  const max = component.max_length && component.max_length > 0 ? component.max_length : undefined;
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {component.label}
        {component.required === false ? "" : " *"}
      </span>
      {component.style === "paragraph" ? (
        <textarea
          className={styles.textarea}
          value={value}
          maxLength={max}
          placeholder={component.placeholder ?? ""}
          required={component.required !== false}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={styles.input}
          type="text"
          value={value}
          maxLength={max}
          placeholder={component.placeholder ?? ""}
          required={component.required !== false}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

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
