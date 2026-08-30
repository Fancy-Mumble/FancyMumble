import { createRoot } from "react-dom/client";
import MediaPlayer from "@shared/mediaplayer/MediaPlayer";
import "@standard/theme.css";

/** The attachment player, in its three states, on the chat surface it sits on. */
function Gallery() {
  return (
    <div
      style={{
        background: "#0b0f17",
        minHeight: "100vh",
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        fontFamily: "system-ui, sans-serif",
        color: "#8b93a5",
      }}
    >
      <div>
        <p style={{ fontSize: 12, margin: "0 0 8px" }}>video</p>
        <div style={{ width: 460 }}>
          <MediaPlayer src="/probe.mp4" kind="video" label="clip.mp4" />
        </div>
      </div>
      <div>
        <p style={{ fontSize: 12, margin: "0 0 8px" }}>audio</p>
        <div
          style={{
            width: 460,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.08)",
            borderRadius: 8,
          }}
        >
          <MediaPlayer src="/probe.opus" kind="audio" label="talk.opus" />
        </div>
      </div>
      <div>
        <p style={{ fontSize: 12, margin: "0 0 8px" }}>a source that will not load</p>
        <div style={{ width: 460 }}>
          <MediaPlayer src="/nope.mp4" kind="video" label="gone.mp4" />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
