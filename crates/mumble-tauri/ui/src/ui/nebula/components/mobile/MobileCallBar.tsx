/**
 * A call in progress, on the one strip of a phone that can carry it.
 *
 * The window keeps this at the foot of the channel column, where it can be a
 * card. Here it is a band above the composer: who is talking, who is in, and
 * the two controls worth reaching without opening anything - mute, and leave.
 * Everything else is a tap away on `MobileVoiceScreen`, which is what the rest
 * of the band opens.
 *
 * Drawn on the rail's colours rather than the window's, because a call is the
 * one thing on this screen that is still happening while you read something
 * else, and the rail is where this pack puts "elsewhere".
 */
import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { CloseIcon, MicIcon, MicOffIcon } from "@ui/icons";
import { Stack, TalkingBars, UserAvatar } from "../primitives";
import type { VoiceModel } from "../../shellModel";
import { DisplayText, PlateButton, useStencil } from "./mobileMarks";

export function MobileCallBar({
  model,
  onExpand,
}: Readonly<{ model: VoiceModel; onExpand: () => void }>) {
  const { t } = useTranslation(["nebulaChat", "chat"]);
  const stencil = useStencil();
  const nebula = useTheme().palette.nebula;
  const speaking = model.participants.find((user) => model.talkingSessions.has(user.session));
  // The rail's accent, not the window's: this band stands on the rail, and the
  // window's accent is picked for contrast against a pale surface.
  const accent = stencil ? nebula.accentOnRail : nebula.railText;

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1.25}
      data-testid="nebula-mobile-call-bar"
      sx={{
        flex: "none",
        px: "12px",
        py: "10px",
        // The rule the artboard draws in the second accent, which is also what
        // separates a live call from the chrome under it.
        borderTop: `3px solid ${accent}`,
        background: `linear-gradient(100deg,${nebula.rail},${nebula.railEdge})`,
        color: nebula.railText,
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={onExpand}
        data-testid="nebula-mobile-call-expand"
        sx={{
          all: "unset",
          cursor: "pointer",
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: "11px",
        }}
      >
        <TalkingBars talking={!!speaking} />
        <Box sx={{ minWidth: 0, flex: 1, textAlign: "left" }}>
          <DisplayText size={12} colour={accent}>
            {model.elapsedLabel
              ? `${t("nebulaChat:channelInfo.labelInVoice")} · ${model.elapsedLabel}`
              : t("nebulaChat:channelInfo.labelInVoice")}
          </DisplayText>
          <Box
            sx={{
              mt: "1px",
              fontSize: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: nebula.railDim,
            }}
          >
            {speaking
              ? t("nebulaChat:mobile.speaking", {
                  name: speaking.name,
                  count: model.participants.length,
                })
              : t("nebulaChat:mobile.connected", { count: model.participants.length })}
          </Box>
        </Box>
        {/* Who is in, overlapped the way a call stacks its faces. */}
        <Stack direction="row" sx={{ flex: "none", mr: "2px" }}>
          {model.participants.slice(0, 3).map((user, index) => (
            <Box key={user.session} sx={{ ml: index === 0 ? 0 : "-9px" }}>
              {/* No halo: the band's own rule is where one would hang, and
                  two overlapped faces wearing them read as spectacles. */}
              <UserAvatar
                name={user.name}
                session={user.session}
                textureSize={user.texture_size}
                size={26}
                halo={false}
              />
            </Box>
          ))}
        </Stack>
      </Box>
      <PlateButton
        on="rail"
        tone={model.micLive ? "quiet" : "danger"}
        height={40}
        onClick={model.onToggleMic}
        label={model.micLive ? t("chat:callControls.mute") : t("chat:callControls.unmute")}
        pressed={!model.micLive}
        testId="nebula-mobile-call-mic"
      >
        {model.micLive ? <MicIcon width={15} height={15} /> : <MicOffIcon width={15} height={15} />}
      </PlateButton>
      <PlateButton
        on="rail"
        tone="danger"
        height={40}
        onClick={model.onLeave}
        label={t("nebulaChat:mobile.leaveVoice")}
        testId="nebula-mobile-call-leave"
      >
        <CloseIcon width={15} height={15} />
      </PlateButton>
    </Stack>
  );
}
