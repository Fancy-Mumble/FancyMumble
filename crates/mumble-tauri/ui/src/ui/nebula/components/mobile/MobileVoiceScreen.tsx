/**
 * The call, given the whole screen.
 *
 * The one surface here with no counterpart on a window: a window never needs
 * it, because the dock, the roster and the conversation are all on screen at
 * once. On a phone they are not, so "who is in this call and what is my
 * microphone doing" has nowhere to be read at a glance - and it is the thing
 * most worth reading while the phone is in your hand.
 *
 * Drawn on the rail, full bleed, so it reads as somewhere you have gone rather
 * than a panel over the conversation.
 */
import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ChevronDownIcon, HeadphonesIcon, MicIcon, MicOffIcon, MonitorIcon } from "@ui/icons";
import { Stack, TalkingBars, UserAvatar, useIsTalking } from "../primitives";
import type { VoiceModel } from "../../shellModel";
import type { UserEntry } from "@core/types";
import { DisplayText, PlateButton, useStencil } from "./mobileMarks";
import { SAFE_AREA } from "../../tokens";

export function MobileVoiceScreen({
  model,
  onCollapse,
}: Readonly<{ model: VoiceModel; onCollapse: () => void }>) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const stencil = useStencil();
  const nebula = useTheme().palette.nebula;
  const accent = stencil ? nebula.accentOnRail : nebula.railText;

  return (
    <Stack
      data-testid="nebula-mobile-voice"
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        minHeight: 0,
        overflow: "hidden",
        color: nebula.railText,
        // Over the window's own ground: the rail's colours are glass on most
        // skins, and a screen of glass let the conversation beneath read
        // through the call.
        background: `linear-gradient(180deg,${nebula.rail},${nebula.railEdge}),${nebula.bg0}`,
      }}
    >
      {/* The artboard's ring and dot grid. Both are decoration and both are
          drawn from the rail's own hairline, so a skin with a quiet rail gets
          a quiet backdrop rather than somebody else's blue. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(${nebula.railLine} 1.5px, transparent 1.6px)`,
          backgroundSize: "24px 24px",
          opacity: 0.9,
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: -120,
          right: -140,
          width: 420,
          height: 420,
          borderRadius: "50%",
          border: `3px solid ${nebula.railLine}`,
        }}
      />

      <Stack
        direction="row"
        alignItems="center"
        gap={1.5}
        // The screen is laid over the shell's padding, not inside it, so it
        // clears the status bar itself.
        sx={{ position: "relative", px: "20px", pt: `calc(22px + ${SAFE_AREA.top})`, flex: "none" }}
      >
        <Box
          component="button"
          type="button"
          onClick={onCollapse}
          aria-label={t("common:actions.close")}
          data-testid="nebula-mobile-voice-collapse"
          sx={{ all: "unset", cursor: "pointer", display: "flex", color: nebula.railText }}
        >
          <ChevronDownIcon width={20} height={20} />
        </Box>
        {stencil ? (
          <Box sx={{ transform: "skewX(-12deg)", background: accent, px: "12px", py: "4px" }}>
            <Box
              sx={{
                transform: "skewX(12deg)",
                fontStyle: "italic",
                fontWeight: 800,
                fontSize: 11,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: nebula.rail,
              }}
            >
              {t("nebulaChat:mobile.voiceActive")}
            </Box>
          </Box>
        ) : (
          <DisplayText size={12} colour={accent}>
            {t("nebulaChat:mobile.voiceActive")}
          </DisplayText>
        )}
        <Box sx={{ flex: 1 }} />
        {model.elapsedLabel && (
          <DisplayText size={12} colour={nebula.railDim}>
            {model.elapsedLabel}
          </DisplayText>
        )}
      </Stack>

      <Box sx={{ position: "relative", px: "20px", pt: "26px", flex: "none" }}>
        {/* A name somebody typed, so the skin's shouting does not apply. */}
        <DisplayText size={28} colour={nebula.railText} caps={false} testId="nebula-mobile-voice-title">
          {model.channelName}
        </DisplayText>
        {model.codecLabel && (
          <Box
            sx={{
              mt: "10px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: nebula.railDim,
            }}
          >
            {model.codecLabel}
          </Box>
        )}
      </Box>

      <Stack
        gap={1.75}
        sx={{ position: "relative", px: "20px", pt: "30px", flex: 1, minHeight: 0, overflowY: "auto" }}
      >
        {model.participants.map((user) => (
          <VoiceRow key={user.session} user={user} model={model} />
        ))}
      </Stack>

      <Stack
        gap={1.75}
        sx={{ position: "relative", px: "20px", pt: "16px", pb: `calc(24px + ${SAFE_AREA.bottom})` }}
      >
        <Stack direction="row" gap={1.25}>
          <PlateButton
            grow
            on="rail"
            height={62}
            tone={model.micLive ? "quiet" : "danger"}
            onClick={model.onToggleMic}
            label={model.micLive ? t("chat:callControls.mute") : t("chat:callControls.unmute")}
            pressed={!model.micLive}
            testId="nebula-mobile-voice-mic"
          >
            {model.micLive ? <MicIcon width={18} height={18} /> : <MicOffIcon width={18} height={18} />}
          </PlateButton>
          <PlateButton
            grow
            on="rail"
            height={62}
            tone={model.deafened ? "danger" : "quiet"}
            onClick={model.onToggleDeafen}
            label={model.deafened ? t("chat:callControls.undeafen") : t("chat:callControls.deafen")}
            pressed={model.deafened}
            testId="nebula-mobile-voice-deafen"
          >
            <HeadphonesIcon width={18} height={18} />
          </PlateButton>
          {model.onShareScreen && (
            <PlateButton
              grow
              on="rail"
              height={62}
              tone="quiet"
              onClick={model.onShareScreen}
              label={t("chat:header.shareScreen")}
              testId="nebula-mobile-voice-share"
            >
              <MonitorIcon width={18} height={18} />
            </PlateButton>
          )}
        </Stack>
        <PlateButton
          height={62}
          on="rail"
          tone="danger"
          onClick={model.onLeave}
          label={t("nebulaChat:mobile.disconnect")}
          testId="nebula-mobile-voice-leave"
        >
          <DisplayText size={15}>{t("nebulaChat:mobile.disconnect")}</DisplayText>
        </PlateButton>
      </Stack>
    </Stack>
  );
}

/**
 * One person in the call.
 *
 * A component rather than a block inside the map, so whether they are speaking
 * is a question this row asks the store for itself. The screen used to be
 * handed the whole talking set, which meant every utterance edge re-rendered
 * the screen, its buttons and every other row on it.
 */
function VoiceRow({ user, model }: Readonly<{ user: UserEntry; model: VoiceModel }>) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const stencil = useStencil();
  const nebula = useTheme().palette.nebula;
  const accent = stencil ? nebula.accentOnRail : nebula.railText;
  const talking = useIsTalking(user.session);
  const own = user.session === model.ownSession;
  const muted = own && !model.micLive;

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1.75}
      data-testid="nebula-mobile-voice-row"
      sx={{
        flex: "none",
        px: "14px",
        py: "12px",
        background: nebula.railTile,
        border: `var(--nebula-line-width, 1px) solid ${talking ? accent : nebula.railLine}`,
        borderRadius: "var(--nebula-radius-lg, 12px)",
      }}
    >
      <UserAvatar
        name={user.name}
        session={user.session}
        textureSize={user.texture_size}
        size={48}
        talking={talking}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ fontWeight: 900, fontSize: 17, color: nebula.railText }}>{user.name}</Box>
        <Box
          sx={{
            mt: "2px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: muted ? nebula.bad : talking ? accent : nebula.railDim,
          }}
        >
          {muted
            ? t("nebulaChat:mobile.micMuted")
            : talking
              ? t("nebulaChat:mobile.isSpeaking")
              : t("nebulaChat:mobile.listening")}
        </Box>
      </Box>
      <TalkingBars talking={talking} />
    </Stack>
  );
}
