/**
 * Every menu in the pack: a popover at the pointer on a window, a sheet from
 * the bottom edge on a phone.
 *
 * A 220px popover pinned to where a thumb landed is a desktop idiom - on a
 * phone it opens under the thumb, half off the edge, with rows too close
 * together to hit. What a phone expects is the sheet every chat app there
 * uses: the full width of the screen, rising from the bottom, the page dimmed
 * behind it, and pulled back down to put it away.
 *
 * It is the same MUI `Menu` either way - the same items, keyboard handling and
 * `onClose` - so a menu becomes a sheet by importing this instead of MUI's and
 * nothing else. Whatever the caller placed (an anchor, a position, a paper
 * width) is simply overruled on a handheld.
 */
import { useState } from "react";
import { Menu as MuiMenu, Slide, type MenuProps, type SxProps, type Theme } from "@mui/material";
import { useIsHandheld } from "../../useIsHandheld";
import { floatingSurface } from "../../theme";
import { SAFE_AREA, radius } from "../../tokens";
import { SHEET_EASE, SHEET_ENTER_MS, usePullToDismiss } from "./usePullToDismiss";

const EXIT_MS = 170;

/** A tablet is handheld too, but a sheet as wide as one reads as a banner. */
const SHEET_MAX_WIDTH = 560;

const SHEET_PAPER: SxProps<Theme> = (theme) => ({
  // Popover places its paper with inline `top`/`left`; with no anchor it
  // writes neither, so these are the whole of where it goes.
  top: "auto",
  left: 0,
  right: 0,
  bottom: 0,
  m: "0 auto",
  width: "auto",
  minWidth: 0,
  maxWidth: SHEET_MAX_WIDTH,
  maxHeight: "85%",
  p: "10px 8px",
  pb: `calc(10px + ${SAFE_AREA.bottom})`,
  // Only the top corners: the other two are off the bottom of the screen.
  borderRadius: `${radius("xl")} ${radius("xl")} 0 0`,
  borderBottom: "none",
  ...floatingSurface(theme),
  // The grab handle every sheet on a phone has - the sign it can be pushed
  // back down.
  "&::before": {
    content: '""',
    display: "block",
    flex: "none",
    width: 34,
    height: 4,
    m: "0 auto 10px",
    borderRadius: "var(--nebula-radius-pill, 999px)",
    background: theme.palette.nebula.line2,
  },
});

const SHEET_LIST: SxProps<Theme> = { width: "auto", minWidth: 0 };

type SlotSx = { sx?: SxProps<Theme> } & Record<string, unknown>;

/** The caller's sx first, the sheet's last, so the sheet has the last word. */
function withSx(slot: unknown, sx: SxProps<Theme>, extra: Record<string, unknown> = {}): unknown {
  const merge = (own: SlotSx | undefined) => {
    const prior = own?.sx;
    const list = Array.isArray(prior) ? prior : prior === undefined ? [] : [prior];
    return { ...own, ...extra, sx: [...list, sx] };
  };
  if (typeof slot === "function") return (state: unknown) => merge((slot as (s: unknown) => SlotSx)(state));
  return merge(slot as SlotSx | undefined);
}

export function Menu(props: MenuProps) {
  const handheld = useIsHandheld();
  const [paper, setPaper] = useState<HTMLElement | null>(null);
  const { onClose } = props;
  usePullToDismiss(
    handheld && props.open ? paper : null,
    () => paper,
    () => onClose?.({}, "backdropClick"),
  );

  if (!handheld) return <MuiMenu {...props} />;

  const slotProps = props.slotProps ?? {};
  return (
    <MuiMenu
      {...props}
      anchorEl={null}
      anchorReference="none"
      marginThreshold={0}
      transitionDuration={{ enter: SHEET_ENTER_MS, exit: EXIT_MS }}
      slots={{ ...props.slots, transition: Slide }}
      slotProps={
        {
          ...slotProps,
          paper: withSx(slotProps.paper, SHEET_PAPER, { ref: setPaper, "data-nebula-sheet": "" }),
          list: withSx(slotProps.list, SHEET_LIST),
          backdrop: withSx(slotProps.backdrop, { background: "rgba(0,0,0,.42)" }, { invisible: false }),
          transition: {
            ...(typeof slotProps.transition === "object" ? slotProps.transition : {}),
            direction: "up",
            easing: { enter: SHEET_EASE, exit: SHEET_EASE },
          },
          // The slot is typed for the generic transition; `direction` is Slide's.
        } as unknown as MenuProps["slotProps"]
      }
    />
  );
}
