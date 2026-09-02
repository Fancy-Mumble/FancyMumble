import { Box, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import type { OnboardingAnswer, OnboardingQuestion } from "@core/types";
import { Stack, UserAvatar } from "../../primitives";
import { serverTint } from "../../../selectors";
import { useServerLivery } from "../../../useServerLivery";
import { radius } from "../../../tokens";
import { mappingLabel, type Mapping, type TFn } from "./mapping";

/**
 * The questionnaire from the other side.
 *
 * Every control on the onboarding page decides something a new member sees
 * once, on their way in, and never again - so the card that shows it is beside
 * the editor rather than behind a preview button. The line under it spells out
 * the consequence of the first answer, which is the part that is otherwise
 * invisible until someone has already been placed somewhere.
 *
 * The rail editor hangs one of these beside the question it has open; the node
 * canvas hangs one under every question node, which is the same card saying the
 * same thing about a different question.
 */
export function MemberPreview({
  question,
  index,
  total,
  mappingsOf,
  t,
  heading,
}: Readonly<{
  question: OnboardingQuestion | null;
  index: number;
  total: number;
  mappingsOf: (answer: OnboardingAnswer) => Mapping[];
  t: TFn;
  /** Off for the copy hung under a node, which its caption already names. */
  heading?: boolean;
}>) {
  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  // The tab this page is administering, never whichever server pushed last.
  const livery = useServerLivery(activeServerId);
  const active = sessions.find((session) => session.id === activeServerId);
  const serverName = livery?.displayName || active?.label || active?.host || t("onboarding.admin.thisServer");
  const first = question?.answers[0] ?? null;
  const firstMappings = first ? mappingsOf(first) : [];

  return (
    <>
      {heading !== false && (
        <Typography
          sx={(theme) => ({
            mb: "10px",
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: ".08em",
            color: theme.palette.nebula.dim,
          })}
        >
          {t("onboarding.admin.previewTitle")}
        </Typography>
      )}
      <Box
        sx={(theme) => ({
          p: "18px",
          borderRadius: radius("xl"),
          border: `1px solid ${theme.palette.nebula.line2}`,
          background: `${theme.palette.nebula.tint},${theme.palette.nebula.bg0}`,
          boxShadow: theme.palette.nebula.shadow,
          backdropFilter: "blur(16px)",
        })}
      >
        <Stack direction="row" alignItems="center" gap={1.125}>
          <UserAvatar
            name={serverName}
            size={30}
            square
            src={livery?.iconSrc ?? null}
            gradient={serverTint(active ? `${active.host}:${active.port}` : serverName)}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
              {t("onboarding.admin.previewWelcome", { server: serverName })}
            </Typography>
            <Typography sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
              {t("onboarding.admin.previewStep", { n: Math.max(index + 1, 1), m: Math.max(total, 1) })}
            </Typography>
          </Box>
        </Stack>

        <Typography sx={{ mt: "14px", fontSize: 13, fontWeight: 600 }}>
          {question?.text || t("onboarding.admin.untitledQuestion")}
        </Typography>

        <Stack gap={0.75} sx={{ mt: "10px" }}>
          {(question?.answers ?? []).map((answer, position) => {
            const picked = position === 0;
            return (
              <Stack
                key={answer.id}
                direction="row"
                alignItems="center"
                gap={1.125}
                sx={(theme) => ({
                  px: "11px",
                  py: "9px",
                  borderRadius: radius("md"),
                  fontSize: 12,
                  fontWeight: picked ? 500 : 400,
                  color: picked ? theme.palette.nebula.text : theme.palette.nebula.muted,
                  background: picked ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
                  border: `1px solid ${picked ? theme.palette.nebula.accentLine : theme.palette.nebula.line}`,
                })}
              >
                <Box component="span" sx={{ minWidth: 0 }}>
                  {answer.emoji ? `${answer.emoji} ` : ""}
                  {answer.label || t("onboarding.admin.answerLabelField")}
                </Box>
                <Box
                  aria-hidden
                  sx={(theme) => ({
                    ml: "auto",
                    flex: "none",
                    width: 14,
                    height: 14,
                    borderRadius: question?.multi_select ? radius("sm") : "50%",
                    border: picked
                      ? `4.5px solid ${theme.palette.nebula.accent}`
                      : `1.5px solid ${theme.palette.nebula.line2}`,
                  })}
                />
              </Stack>
            );
          })}
        </Stack>

        <Stack direction="row" alignItems="center" sx={{ mt: "16px" }}>
          <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
            {question?.required ? t("onboarding.modal.required") : t("onboarding.modal.skipBtn")}
          </Typography>
          <Box
            sx={(theme) => ({
              ml: "auto",
              px: "16px",
              py: "7px",
              borderRadius: radius("md"),
              background: theme.palette.nebula.accent,
              color: theme.palette.nebula.onAccent,
              fontSize: 11.5,
              fontWeight: 600,
            })}
          >
            {index + 1 < total ? t("onboarding.modal.nextBtn") : t("onboarding.modal.finishBtn")}
          </Box>
        </Stack>
      </Box>

      <Typography
        sx={(theme) => ({
          mt: "8px",
          fontSize: 10.5,
          lineHeight: 1.5,
          textAlign: "center",
          color: theme.palette.nebula.dim,
        })}
      >
        {first && first.label && firstMappings.length > 0
          ? t("onboarding.admin.previewMapping", {
              answer: first.label,
              targets: firstMappings.map(mappingLabel).join(", "),
            })
          : t("onboarding.admin.previewNoMapping")}
      </Typography>
    </>
  );
}
