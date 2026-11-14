import { useId, useState, type ReactNode } from "react";
import { Box } from "@mui/material";
import { ChevronDownIcon } from "@ui/icons";
import { radius } from "../../tokens";

/**
 * A row that opens to show what it holds: a native button carrying the
 * label, and the body under it while open.
 *
 * Closed by default, so a list of these reads as a list of names until one
 * is asked about.
 */
export function Disclosure({ label, children }: Readonly<{ label: ReactNode; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <Box>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          px: "8px",
          py: "6px",
          border: 0,
          borderRadius: radius("md"),
          font: "inherit",
          fontSize: 12.5,
          fontWeight: 600,
          textAlign: "left",
          color: theme.palette.nebula.text,
          background: open ? theme.palette.nebula.card2 : "transparent",
          cursor: "pointer",
          "&:hover": { background: theme.palette.nebula.card2 },
        })}
      >
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
          {label}
        </Box>
        <Box
          component="span"
          aria-hidden
          sx={{ display: "flex", transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }}
        >
          <ChevronDownIcon width={12} height={12} />
        </Box>
      </Box>
      {open && (
        <Box id={bodyId} sx={{ px: "8px", pt: "6px", pb: "10px" }}>
          {children}
        </Box>
      )}
    </Box>
  );
}
