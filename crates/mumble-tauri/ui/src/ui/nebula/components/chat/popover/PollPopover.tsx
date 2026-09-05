import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, InputBase, Typography } from "@mui/material";
import { CloseIcon } from "@ui/icons";
import { Stack } from "../../primitives";
import { PopoverPanel } from "./PopoverPanel";
import { TID } from "@core/testids";

/** The canvas's width for this panel. */
export const POLL_POPOVER_WIDTH = 400;

/** How many options a poll may carry before the composer stops offering more. */
const MAX_OPTIONS = 10;

/**
 * The poll composer, as a popover on the composer's inset.
 *
 * Every row is a hairline-divided line rather than a boxed field - the panel
 * is the container, the same rule the composer follows. The last row is always
 * an empty one, so adding an option is typing rather than pressing Add: a
 * button would be a second thing to find for something the list can offer by
 * simply being one longer.
 */
export function PollPopover({
  left,
  onSubmit,
  onClose,
}: Readonly<{
  left: number;
  onSubmit: (question: string, options: string[], multiple: boolean) => void;
  onClose: () => void;
}>) {
  const { t } = useTranslation("nebulaChat");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multiple, setMultiple] = useState(false);

  const filled = options.map((option) => option.trim()).filter(Boolean);
  // Two real answers is the least that is still a question.
  const postable = question.trim().length > 0 && filled.length >= 2;

  const setOption = (index: number, value: string) => {
    setOptions((prev) => {
      const next = [...prev];
      next[index] = value;
      // Keep exactly one empty row at the end, up to the cap.
      while (next.length < MAX_OPTIONS && next.at(-1)?.trim()) next.push("");
      return next;
    });
  };

  return (
    <PopoverPanel width={POLL_POPOVER_WIDTH} left={left} title={t("poll.title")} onClose={onClose}>
      <Box sx={{ px: "14px", pt: "14px", pb: "6px" }}>
        <InputBase
          autoFocus
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("poll.questionPlaceholder")}
          inputProps={{ "aria-label": t("poll.questionLabel"), "data-testid": TID.pollQuestionInput }}
          sx={{
            width: "100%",
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            "& .MuiInputBase-input": { padding: 0 },
          }}
        />
      </Box>

      <Stack sx={{ px: "14px" }}>
        {options.map((option, index) => (
          <Stack
            key={index}
            direction="row"
            alignItems="center"
            gap="10px"
            sx={(theme) => ({
              height: 42,
              flex: "none",
              borderBottom: index === options.length - 1 ? "none" : `1px solid ${theme.palette.nebula.line}`,
            })}
          >
            <Typography sx={(theme) => ({ width: 14, fontSize: 12, color: theme.palette.nebula.dim })}>
              {index + 1}
            </Typography>
            <InputBase
              value={option}
              onChange={(event) => setOption(index, event.target.value)}
              placeholder={index >= 2 ? t("poll.optionPlaceholder") : t("poll.option")}
              inputProps={{
                "aria-label": t("poll.optionAria", { index: index + 1 }),
                "data-testid": TID.pollOptionInput,
              }}
              sx={{ flex: 1, fontSize: 14, "& .MuiInputBase-input": { padding: 0 } }}
            />
            {options.length > 2 && (
              <Box
                component="button"
                type="button"
                aria-label={t("poll.removeOption", { index: index + 1 })}
                onClick={() => setOptions((prev) => prev.filter((_, at) => at !== index))}
                sx={(theme) => ({
                  all: "unset",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  color: theme.palette.nebula.dim,
                  "&:hover": { color: theme.palette.nebula.text },
                })}
              >
                <CloseIcon width={12} height={12} />
              </Box>
            )}
          </Stack>
        ))}
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        gap="10px"
        sx={(theme) => ({
          px: "14px",
          py: "12px",
          flex: "none",
          borderTop: `1px solid ${theme.palette.nebula.washLine}`,
        })}
      >
        <Stack
          direction="row"
          gap="2px"
          sx={(theme) => ({ p: "2px", borderRadius: "999px", background: theme.palette.nebula.card2 })}
        >
          {(["Single", "Multi"] as const).map((mode) => {
            const on = (mode === "Multi") === multiple;
            return (
              <Box
                key={mode}
                component="button"
                type="button"
                data-testid={mode === "Multi" ? TID.pollMultiple : undefined}
                aria-pressed={on}
                onClick={() => setMultiple(mode === "Multi")}
                sx={(theme) => ({
                  all: "unset",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  height: 28,
                  px: "14px",
                  borderRadius: "999px",
                  fontSize: 13,
                  fontWeight: on ? 600 : 400,
                  color: on ? theme.palette.nebula.text : theme.palette.nebula.muted,
                  background: on ? theme.palette.nebula.hover : "transparent",
                })}
              >
                {mode === "Multi" ? t("poll.multi") : t("poll.single")}
              </Box>
            );
          })}
        </Stack>

        <Box sx={{ flex: 1 }} />

        <Box
          component="button"
          type="button"
          data-testid={TID.pollSubmit}
          disabled={!postable}
          onClick={() => onSubmit(question.trim(), filled, multiple)}
          sx={(theme) => ({
            all: "unset",
            cursor: postable ? "pointer" : "default",
            display: "grid",
            placeItems: "center",
            height: 32,
            px: "18px",
            borderRadius: "999px",
            fontSize: 13,
            fontWeight: 600,
            // The one filled thing on this surface, as on every other.
            background: postable ? theme.palette.nebula.accent : theme.palette.nebula.card2,
            color: postable ? theme.palette.nebula.onAccent : theme.palette.nebula.dim,
          })}
        >
          {t("poll.post")}
        </Box>
      </Stack>
    </PopoverPanel>
  );
}
