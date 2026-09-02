/**
 * The twelve skins, both schemes, painted from the pack's own resolved tokens.
 *
 * Deliberately the same anatomy as the design sheet's artboards - 880x590,
 * a 52px rail, a 236px channel column, the same twelve channels - so a render
 * here and an artboard there can be put side by side and disagreements are
 * about values rather than about layout. What it paints comes from
 * `nebulaScheme`, so this is a check on the implementation, not a second copy
 * of the design.
 */
import "@standard/theme.css";
import { createRoot } from "react-dom/client";
import { NEBULA_THEMES, type NebulaThemeDef } from "@nebula/themeCatalog";
import { nebulaScheme, type NebulaScheme } from "@nebula/themeScheme";

const CHANNELS: [string, string][] = [
  ["[ 💤 ] AFK", "6px"],
  ["30 min", "14px"],
  ["60 min", "14px"],
  ["Eine Sebi-Sekunde", "14px"],
  ["Vielleicht auch 2", "22px"],
  ["Essen", "14px"],
  ["[ ⚔ ] Factions", "6px"],
  ["[ ❗ ] Contracts (0)", "6px"],
  ["Hall of Fame", "14px"],
  ["[ 💚 ] Green is fucked", "6px"],
  ["[ 🍟 ] Pommes Klauen", "6px"],
  ["[ 🎌 ] Back From Japan", "6px"],
];

function glassLabel(glass: number): string {
  if (glass === 0) return "opaque";
  if (glass < 0.2) return "light veil";
  if (glass < 0.35) return "frosted";
  return "heavy glass";
}

function Window({ scheme }: { scheme: NebulaScheme }) {
  const t = scheme.tokens;
  const s = scheme.skin;
  const blur = s.glass ? `blur(${s.blurPx}px) saturate(1.15)` : "none";
  const font = s.font;

  return (
    <div
      style={{
        position: "relative",
        width: 880,
        height: 590,
        borderRadius: s.radiusXl,
        clipPath: s.clipWindow,
        overflow: "hidden",
        boxShadow: "0 18px 44px rgba(0,0,0,.5)",
        background: t.bg0,
        fontFamily: font,
        letterSpacing: s.track,
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: t.window }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
        {/* Title bar */}
        <div
          style={{
            height: 42,
            flex: "none",
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            background: t.bar,
            backdropFilter: blur,
            borderBottom: `1px solid ${t.line2}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: s.radiusSm,
                background: t.accent,
                color: t.onAccent,
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              M
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: t.barText,
                textTransform: s.caps,
              }}
            >
              Fancy Mumble
            </div>
          </div>
          <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: t.barDim }}>magical.rocks</div>
          <div
            style={{
              display: "flex",
              gap: 16,
              color: t.barFaint,
              fontSize: 12,
              width: 100,
              justifyContent: "flex-end",
            }}
          >
            <span>—</span>
            <span>▢</span>
            <span>✕</span>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Server rail */}
          <div
            style={{
              width: 52,
              flex: "none",
              background: t.rail,
              backdropFilter: blur,
              borderRight: `1px solid ${t.railLine}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 9,
              padding: "11px 0",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: s.radiusSm,
                background: t.railTile,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: t.railText,
                fontSize: 13,
              }}
            >
              ›
            </div>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: s.radiusSm,
                background: t.accentSoft,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: t.accentOnRail,
                fontSize: 13,
              }}
            >
              ☺
            </div>
            <div
              style={{
                position: "relative",
                width: 34,
                height: 34,
                borderRadius: s.radiusRail,
                background: t.railTile,
                boxShadow: `0 0 0 2px ${t.accent}`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: -2,
                  bottom: -2,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: t.ok,
                  border: `2px solid ${t.railEdge}`,
                }}
              />
            </div>
            {["19", "L"].map((label) => (
              <div
                key={label}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: s.radiusRail,
                  background: t.railTile,
                  color: t.railText,
                  fontSize: 13,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {label}
              </div>
            ))}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: s.radiusSm,
                border: `1px dashed ${t.railDim}`,
                color: t.railDim,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
              }}
            >
              +
            </div>
          </div>

          {/* Channel column */}
          <div
            style={{
              width: 236,
              flex: "none",
              background: t.panel,
              backdropFilter: blur,
              borderRight: `1px solid ${t.line2}`,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  height: 32,
                  padding: "0 9px",
                  borderRadius: s.radiusMd,
                  background: t.input,
                  border: `1px solid ${t.line2}`,
                }}
              >
                <span style={{ color: t.dim, fontSize: 12 }}>⌕</span>
                <span style={{ flex: 1, fontSize: 12, fontWeight: s.weight, color: t.dim }}>
                  Search channels
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: t.muted,
                    background: t.card2,
                    padding: "2px 5px",
                    borderRadius: s.radiusSm,
                  }}
                >
                  Ctrl+F
                </span>
              </div>
            </div>
            <div
              style={{
                flex: 1,
                overflow: "hidden",
                padding: "0 7px",
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 9px" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: t.muted,
                  }}
                >
                  Magical Rocks
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: t.accentText,
                    background: t.accentSoft,
                    padding: "1px 5px",
                    borderRadius: s.radiusSm,
                  }}
                >
                  E
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: t.dim }}>1</span>
              </div>
              {CHANNELS.map(([name, pad]) => {
                const selected = name.includes("Green");
                const solid = selected && s.selection === "solid";
                return (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "6px 9px",
                      borderRadius: s.radiusMd,
                      background: solid ? t.accent : selected ? t.accentSoft : "transparent",
                      boxShadow: selected
                        ? s.selectionGlow
                          ? `0 0 14px ${t.accentLine}`
                          : s.selectionBar
                            ? `inset 3px 0 0 ${t.accent}`
                            : "none"
                        : "none",
                      clipPath: selected ? s.clipSelection : "none",
                    }}
                  >
                    <span
                      style={{
                        color: solid ? t.onAccent : selected ? t.accentText : t.dim,
                        fontSize: 11,
                        marginLeft: pad,
                      }}
                    >
                      #
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: selected ? 700 : s.weight,
                        color: solid ? t.onAccent : t.text,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {name}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: 9 }}>
              <div
                style={{
                  background: t.card,
                  border: `1px solid ${t.line2}`,
                  borderRadius: s.radiusLg,
                  padding: "9px 10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <div
                    style={{
                      position: "relative",
                      width: 30,
                      height: 30,
                      borderRadius: s.radiusAvatar,
                      background: t.tile,
                      flex: "none",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        right: -1,
                        bottom: -1,
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: t.ok,
                        border: `2px solid ${t.cardEdge}`,
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>Zewi</div>
                    <div
                      style={{
                        fontSize: 10,
                        color: t.muted,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      [ 💚 ] Green is fucked
                    </div>
                  </div>
                  <span style={{ color: t.dim, fontSize: 13 }}>⋮</span>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                  {["🎙", "🎧"].map((icon) => (
                    <div
                      key={icon}
                      style={{
                        width: 29,
                        height: 26,
                        borderRadius: s.radiusSm,
                        background: t.card2,
                        color: t.muted,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                      }}
                    >
                      {icon}
                    </div>
                  ))}
                  <div
                    style={{
                      marginLeft: "auto",
                      width: 29,
                      height: 26,
                      borderRadius: s.radiusSm,
                      background: t.accentSoft,
                      color: t.accentText,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                    }}
                  >
                    ⧉
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Conversation */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div
              style={{
                height: 48,
                flex: "none",
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "0 16px",
                borderBottom: `1px solid ${t.line2}`,
                background: t.header,
                backdropFilter: blur,
              }}
            >
              <span style={{ color: t.accentText, fontSize: 14 }}>#</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>[ 💚 ] Green is fucked</div>
                <div style={{ fontSize: 10, color: t.muted }}>1 in voice</div>
              </div>
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  color: t.muted,
                  fontSize: 12,
                }}
              >
                <span style={{ fontSize: 11 }}>👥 1</span>
                <span>⌕</span>
                <span>📌</span>
                <span>⋮</span>
              </div>
            </div>

            <div style={{ flex: 1, position: "relative", overflow: "hidden", background: t.backdrop }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  gap: 8,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    alignSelf: "flex-start",
                    maxWidth: "78%",
                    padding: "9px 12px",
                    borderRadius: s.radiusLg,
                    background: t.card,
                    border: `1px solid ${t.line2}`,
                    color: t.text,
                    fontSize: 12.5,
                  }}
                >
                  btw finally sorted the NYC photos from last week — the ferry ones came out great
                </div>
                <div
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "78%",
                    padding: "9px 12px",
                    borderRadius: s.radiusLg,
                    background: t.accent,
                    color: t.onAccent,
                    fontSize: 12.5,
                  }}
                >
                  save me a slot, 20 min out — jonas don&apos;t dodge the first lobby this time
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["ok", "warn", "bad"] as const).map((tone) => (
                    <span
                      key={tone}
                      style={{
                        padding: "2px 7px",
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                        color: t[tone],
                        border: `1px solid ${t[tone]}`,
                      }}
                    >
                      {tone}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                flex: "none",
                padding: "11px 16px 14px",
                borderTop: `1px solid ${t.line2}`,
                background: t.header,
                backdropFilter: blur,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  height: 42,
                  padding: "0 12px",
                  borderRadius: s.radiusLg,
                  background: t.input,
                  border: `1px solid ${t.line2}`,
                }}
              >
                <span style={{ color: t.muted, fontSize: 13 }}>📎</span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: t.gifText,
                    background: t.gifBg,
                    padding: "3px 6px",
                    borderRadius: s.radiusSm,
                  }}
                >
                  GIF
                </span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: s.weight, color: t.dim }}>
                  Message #[ 💚 ] Green is fucked
                </span>
                <div
                  style={{
                    width: 25,
                    height: 25,
                    borderRadius: s.radiusAvatar,
                    background: t.accent,
                    color: t.onAccent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                  }}
                >
                  ➤
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeRow({ def }: { def: NebulaThemeDef }) {
  const schemes = (["light", "dark"] as const).map((mode) => nebulaScheme(def.id, mode)!);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".09em",
            background: "#26304a",
            color: "#cdd6ea",
            padding: "5px 9px",
            borderRadius: 6,
          }}
        >
          {def.id}
        </div>
        <div style={{ fontSize: 19, fontWeight: 600, color: "#eef1f7" }}>{def.name}</div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "#f0b64d",
          }}
        >
          {def.audience}
        </div>
        <div style={{ fontSize: 13, color: "#8794ad" }}>{def.note}</div>
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {schemes.map((scheme) => (
          <div key={scheme.mode} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "#7d8aa3",
              }}
            >
              {scheme.mode} · {glassLabel(scheme.skin.glass)}
            </div>
            <Window scheme={scheme} />
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 52,
      padding: 56,
      background: "#0b0e14",
      fontFamily: '"Inter", system-ui, sans-serif',
      minHeight: "100vh",
    }}
  >
    {NEBULA_THEMES.map((def) => (
      <ThemeRow key={def.id} def={def} />
    ))}
  </div>,
);
