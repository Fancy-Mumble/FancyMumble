/**
 * LiveDocEmbedView - the interactive React node view for `LiveDocEmbed`.
 *
 * Renders each embed kind (video / 3D model / object / signature line /
 * signature fields), and for a digital signature it *live-verifies*: it checks
 * the cryptographic signature once and re-hashes the document on every edit, so
 * the card flips to "content changed - re-sign" the instant the signed text no
 * longer matches its checksum.
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toVideoEmbedUrl, type LiveDocEmbedAttrs } from "./liveDocInsert";
import { hashDocument, verifySignature } from "./liveDocSignature";
import { useAppStore } from "../../../store";
import { rebaseFileServerUrl } from "../../../store/fileServer";
import { base64ToBytes } from "../../../utils/base64";

/** three.js is heavy (~600 KB); only pull it in when a model is on screen. */
const LiveDocModelViewer = lazy(() => import("./LiveDocModelViewer"));

/** Fallback cap on the size we'll marshal back as base64 across the IPC
 *  boundary when the server hasn't advertised an upload limit. */
const MODEL_MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;

/**
 * Renders a 3D-model embed: fetches the model through the Tauri backend (which
 * performs the session-scoped auth so only collaborators with document access
 * can read it), turns the bytes into a same-origin blob URL, and hands it to
 * the lazily-loaded three.js viewer.
 */
function ModelEmbed({ attrs }: { attrs: LiveDocEmbedAttrs }) {
  const { t } = useTranslation("chat");
  const src = attrs.src ?? "";
  const name = attrs.title || attrs.fileName || "3D model";
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    let created: string | null = null;
    setStatus("loading");
    setDetail("");
    void (async () => {
      try {
        const config = useAppStore.getState().fileServerConfig;
        const credential = config?.sessionJwt
          ? { kind: "session", value: config.sessionJwt }
          : undefined;
        // Allow any model the server itself would accept (its advertised
        // upload limit); only fall back to a fixed cap when it advertised none.
        const maxBytes =
          config && config.maxFileSizeBytes > 0 ? config.maxFileSizeBytes : MODEL_MAX_DOWNLOAD_BYTES;
        const b64 = await invoke<string>("download_to_base64", {
          request: {
            url: rebaseFileServerUrl(src),
            credential,
            maxBytes,
          },
        });
        if (cancelled) return;
        const blob = new Blob([base64ToBytes(b64) as BlobPart], { type: "model/gltf-binary" });
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setDetail(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  if (!src) {
    return (
      <div className="ld-embed-card ld-embed-model">
        <span className="ld-embed-icon" aria-hidden="true">◰</span>
        <span className="ld-embed-meta">
          <span className="ld-embed-title">{name}</span>
        </span>
      </div>
    );
  }

  const loading = t("liveDoc.insert.modelLoading", { defaultValue: "Loading 3D model…" });

  return (
    <div className="ld-embed-model-viewer">
      <div className="ld-embed-model-bar">
        <span className="ld-embed-icon" aria-hidden="true">◰</span>
        <span className="ld-embed-title">{name}</span>
      </div>
      {status === "ready" && objectUrl ? (
        <Suspense fallback={<div className="ld-embed-model-loading">{loading}</div>}>
          <LiveDocModelViewer url={objectUrl} className="ld-embed-model-canvas" />
        </Suspense>
      ) : status === "error" ? (
        <div className="ld-embed-model-error">
          {t("liveDoc.insert.modelError", { defaultValue: "Could not load model" })}
          {detail ? `: ${detail}` : ""}
        </div>
      ) : (
        <div className="ld-embed-model-loading">{loading}</div>
      )}
    </div>
  );
}

type SignatureStatus = "checking" | "valid" | "modified" | "invalid";

function SignatureCard({ attrs, editor }: { attrs: LiveDocEmbedAttrs; editor: NodeViewProps["editor"] }) {
  const { t } = useTranslation("chat");
  const [status, setStatus] = useState<SignatureStatus>("checking");
  const cryptoOkRef = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sig = {
      name: attrs.name ?? "",
      fingerprint: attrs.fingerprint ?? "",
      signedAt: attrs.signedAt ?? "",
      signature: attrs.signature ?? "",
      publicKey: attrs.publicKey ?? "",
      docHash: attrs.docHash ?? "",
      algorithm: attrs.algorithm ?? "",
    };

    const run = async () => {
      if (cryptoOkRef.current === null) cryptoOkRef.current = await verifySignature(sig);
      if (cancelled) return;
      if (!cryptoOkRef.current) {
        setStatus("invalid");
        return;
      }
      const current = await hashDocument(editor.getText());
      if (cancelled) return;
      setStatus(current === sig.docHash ? "valid" : "modified");
    };

    void run();
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 300);
    };
    editor.on("update", onUpdate);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      editor.off("update", onUpdate);
    };
  }, [attrs, editor]);

  const when = attrs.signedAt ? new Date(attrs.signedAt).toLocaleString() : "";
  const seal = status === "valid" ? "🔏" : status === "checking" ? "⏳" : "⚠️";
  const badge =
    status === "valid"
      ? t("liveDoc.insert.sigValid", { defaultValue: "✓ Verified" })
      : status === "modified"
        ? t("liveDoc.insert.sigModified", { defaultValue: "⚠ Content changed - re-sign" })
        : status === "invalid"
          ? t("liveDoc.insert.sigInvalid", { defaultValue: "✗ Invalid signature" })
          : t("liveDoc.insert.sigChecking", { defaultValue: "Checking…" });

  return (
    <div className={`ld-sig-digital ld-sig-status-${status}`}>
      <span className="ld-sig-digital-seal" aria-hidden="true">{seal}</span>
      <span className="ld-sig-digital-body">
        <span className="ld-sig-digital-name">
          {t("liveDoc.insert.signedBy", { defaultValue: "Digitally signed by {{name}}", name: attrs.name || "Unknown" })}
        </span>
        <span className="ld-sig-digital-meta">{t("liveDoc.insert.sigKey", { defaultValue: "Key" })} {attrs.fingerprint || "-"}</span>
        {when && <span className="ld-sig-digital-meta">{t("liveDoc.insert.sigSigned", { defaultValue: "Signed" })} {when}</span>}
      </span>
      <span className="ld-sig-digital-badge" title={attrs.algorithm || ""}>{badge}</span>
    </div>
  );
}

function EmbedBody({ attrs, editor }: { attrs: LiveDocEmbedAttrs; editor: NodeViewProps["editor"] }) {
  switch (attrs.kind) {
    case "video": {
      const src = toVideoEmbedUrl(attrs.src ?? "") ?? attrs.src ?? "";
      const frame = attrs.frame && attrs.frame !== "plain" ? ` ld-embed-frame-${attrs.frame}` : "";
      return (
        <div className={`ld-embed-video${frame}`}>
          <iframe
            src={src}
            title={attrs.title || "video"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      );
    }
    case "model3d":
      return <ModelEmbed attrs={attrs} />;
    case "object":
      return (
        <div className="ld-embed-card ld-embed-object">
          <span className="ld-embed-icon" aria-hidden="true">🗎</span>
          <span className="ld-embed-meta">
            <span className="ld-embed-title">{attrs.fileName || attrs.title || "Object"}</span>
            {attrs.src && (
              <a className="ld-embed-link" href={attrs.src} download={attrs.fileName || ""} target="_blank" rel="noopener noreferrer">
                Open
              </a>
            )}
          </span>
        </div>
      );
    case "signatureFields":
      return (
        <div className="ld-sig-fields">
          {["Signature", "Name", "Date"].map((label) => (
            <div key={label} className="ld-sig-field">
              <span className="ld-sig-rule" />
              <span className="ld-sig-caption">{label}</span>
            </div>
          ))}
        </div>
      );
    case "signatureDigital":
      return <SignatureCard attrs={attrs} editor={editor} />;
    default: // signatureLine
      return (
        <div className="ld-sig-line">
          <span className="ld-sig-x" aria-hidden="true">✕</span>
          <span className="ld-sig-rule" />
          <span className="ld-sig-caption">{attrs.name || attrs.title || "Signature"}</span>
        </div>
      );
  }
}

export default function LiveDocEmbedView({ node, editor }: NodeViewProps) {
  const attrs = node.attrs as LiveDocEmbedAttrs;
  return (
    <NodeViewWrapper className={`ld-embed ld-embed-${attrs.kind}`} contentEditable={false} data-livedoc-embed={attrs.kind}>
      <EmbedBody attrs={attrs} editor={editor} />
    </NodeViewWrapper>
  );
}
