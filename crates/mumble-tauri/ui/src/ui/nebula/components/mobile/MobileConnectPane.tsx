/**
 * Which login, and go.
 *
 * The second half of the start screen. On a window this stands beside the list
 * of addresses; here the list hands over to it, so it carries the server's own
 * identity at the top - a hero rather than a header, because at this point the
 * question on screen is "is this the right place" and a 66px bar answers it
 * with a line of text.
 *
 * The hero is tinted from the address itself, which is the same hash the rail
 * tiles use, so a server is the same colour wherever you meet it.
 */
import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { ChevronLeftIcon, PlusIcon } from "@ui/icons";
import { Stack, UserAvatar } from "../primitives";
import { chamferedSurface } from "../../theme";
import { radius } from "../../tokens";
import type { MobileConnectModel, MobileIdentity } from "../../shellModel";
import { DisplayText, HazardRule, PlateButton, useStencil } from "./mobileMarks";

function Hero({ model }: Readonly<{ model: MobileConnectModel }>) {
  const { t } = useTranslation("nebulaCommon");
  const stencil = useStencil();
  const nebula = useTheme().palette.nebula;
  const { server } = model;
  return (
    <Box
      data-testid="nebula-mobile-connect-hero"
      sx={{
        position: "relative",
        flex: "none",
        overflow: "hidden",
        pb: "18px",
        background: `linear-gradient(155deg,${nebula.rail},${server.tint.to} 70%,${server.tint.from})`,
        color: nebula.railText,
      }}
    >
      {stencil && (
        <>
          <Box
            aria-hidden
            data-nebula-mark="hatch"
            sx={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(115deg,rgba(255,255,255,.05) 0 14px,transparent 14px 30px)",
            }}
          />
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              top: -70,
              left: -60,
              width: 240,
              height: 240,
              borderRadius: "50%",
              border: `3px solid ${nebula.accent2}`,
              opacity: 0.28,
            }}
          />
        </>
      )}
      {/* The scrim, so a light tint cannot leave white type on white. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg,rgba(10,16,30,.45),rgba(10,16,30,0) 45%,rgba(10,16,30,.72))",
        }}
      />

      <Stack
        direction="row"
        alignItems="center"
        sx={{ position: "relative", px: "14px", pt: "10px", flex: "none" }}
      >
        <Box
          component="button"
          type="button"
          onClick={model.onBack}
          aria-label={t("app.back")}
          data-testid="nebula-mobile-connect-back"
          sx={{
            all: "unset",
            cursor: "pointer",
            width: 44,
            height: 44,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "rgba(255,255,255,.16)",
            border: "var(--nebula-line-width, 1px) solid rgba(255,255,255,.4)",
            borderRadius: radius("md"),
          }}
        >
          <ChevronLeftIcon width={20} height={20} />
        </Box>
      </Stack>

      <Stack
        direction="row"
        alignItems="flex-end"
        gap={1.75}
        sx={{ position: "relative", px: "18px", pt: "16px" }}
      >
        <Box sx={{ position: "relative", flex: "0 0 76px" }}>
          <Box
            sx={{
              width: 76,
              height: 76,
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 24,
              color: "#fff",
              background: `linear-gradient(150deg,${server.tint.from},${server.tint.to})`,
              border: "3px solid #fff",
              borderRadius: radius("rail"),
              boxShadow: "0 10px 24px rgba(10,20,40,.45)",
            }}
          >
            {server.initials}
          </Box>
          {server.online && (
            <Box
              aria-hidden
              sx={{
                position: "absolute",
                right: -6,
                bottom: -5,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: nebula.ok,
                border: "3px solid #fff",
              }}
            />
          )}
        </Box>
        <Box sx={{ minWidth: 0, pb: "4px" }}>
          <DisplayText size={24} colour="#fff" caps={false}>
            {server.label}
          </DisplayText>
          <Box
            sx={{
              mt: "2px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: stencil ? nebula.accent2 : "rgba(255,255,255,.85)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {server.address}
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}

function IdentityRow({
  identity,
  selected,
  onSelect,
}: Readonly<{ identity: MobileIdentity; selected: boolean; onSelect: () => void }>) {
  const nebula = useTheme().palette.nebula;
  return (
    <Box sx={{ position: "relative", flex: "none" }}>
      <Box
        component="button"
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={identity.disabled}
        onClick={onSelect}
        data-testid="nebula-mobile-identity"
        sx={(theme) => ({
          all: "unset",
          boxSizing: "border-box",
          cursor: identity.disabled ? "default" : "pointer",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "13px",
          px: "14px",
          py: "11px",
          opacity: identity.disabled ? 0.55 : 1,
          borderRadius: radius("lg"),
          color: selected ? nebula.onAccent : nebula.text,
          ...chamferedSurface(
            theme,
            selected ? nebula.accent : nebula.card,
            selected ? nebula.accent : nebula.line,
          ),
        })}
      >
        {/* The artboard rings only the login you are arriving as: a halo
            over every row is a mark that has stopped marking anything. */}
        <UserAvatar name={identity.name} size={44} halo={selected} />
        <Box sx={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <Box sx={{ fontWeight: selected ? 900 : 700, fontSize: 16 }}>{identity.name}</Box>
          <Box
            sx={{
              mt: "2px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: selected ? nebula.onAccent : nebula.dim,
              opacity: selected ? 0.85 : 1,
            }}
          >
            {identity.detail}
          </Box>
        </Box>
        {/* The radio the artboard draws: a ring, filled in the second accent
            on the one you are arriving as. */}
        <Box
          aria-hidden
          sx={{
            flex: "none",
            width: 24,
            height: 24,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            border: `${selected ? 3 : 2}px solid ${selected ? nebula.onAccent : nebula.line2}`,
          }}
        >
          {selected && (
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", background: nebula.accent2 }} />
          )}
        </Box>
      </Box>
      {selected && (
        <Box
          aria-hidden
          data-nebula-mark="underbar"
          sx={(theme) => ({
            position: "absolute",
            left: -6,
            top: 8,
            bottom: 8,
            width: theme.palette.nebulaSkin.selectionBar ? 5 : 0,
            background: nebula.accent2,
            clipPath: "var(--nebula-clip-selection, none)",
          })}
        />
      )}
    </Box>
  );
}

export function MobileConnectPane({ model }: Readonly<{ model: MobileConnectModel }>) {
  const { t } = useTranslation(["nebulaCommon", "server"]);
  const stencil = useStencil();
  const nebula = useTheme().palette.nebula;
  const chosen = model.identities.find((identity) => identity.id === model.selectedIdentity);

  return (
    <>
      <Hero model={model} />

      <Stack direction="row" gap={1} sx={{ flex: "none", px: "18px", pt: "12px" }}>
        {model.stats.map((stat) => (
          <Box
            key={stat.label}
            sx={(theme) => ({
              flex: 1,
              minWidth: 0,
              display: "grid",
              placeItems: "center",
              py: "8px",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: ".06em",
              whiteSpace: "nowrap",
              borderRadius: radius("md"),
              color: stat.tone === "ok" ? nebula.ok : nebula.muted,
              ...chamferedSurface(
                theme,
                stat.tone === "ok" ? nebula.card2 : nebula.card,
                stat.tone === "ok" ? nebula.ok : nebula.line,
                "var(--nebula-clip-plate, none)",
              ),
            })}
          >
            {stat.label}
          </Box>
        ))}
      </Stack>

      <Stack
        gap={1.25}
        data-testid="nebula-mobile-identities"
        sx={{ flex: 1, minHeight: 0, px: "18px", pt: "16px", pb: "10px", overflowY: "auto" }}
      >
        <Stack direction="row" alignItems="center" gap={1.25} sx={{ flex: "none" }}>
          <DisplayText size={12} colour={nebula.muted}>
            {t("nebulaCommon:app.joinAs")}
          </DisplayText>
          <Box
            aria-hidden
            sx={{
              flex: 1,
              height: 2,
              background: stencil
                ? `repeating-linear-gradient(90deg,${nebula.line2} 0 6px,transparent 6px 10px)`
                : nebula.line,
            }}
          />
          <Box
            component="button"
            type="button"
            onClick={model.onAddIdentity}
            data-testid="nebula-mobile-add-identity"
            sx={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: nebula.accent,
            }}
          >
            <PlusIcon width={12} height={12} />
            {t("nebulaCommon:app.newIdentity")}
          </Box>
        </Stack>

        {model.identities.map((identity) => (
          <IdentityRow
            key={identity.id}
            identity={identity}
            selected={identity.id === model.selectedIdentity}
            onSelect={() => model.onSelectIdentity(identity.id)}
          />
        ))}
      </Stack>

      <Box sx={{ flex: "none", position: "relative" }}>
        <HazardRule />
        <Stack
          gap={1.5}
          sx={{
            background: nebula.panel,
            px: "18px",
            pt: "14px",
            pb: "calc(18px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <PlateButton
            tone="accent"
            height={62}
            onClick={model.onConnect}
            testId="nebula-mobile-connect-go"
          >
            <DisplayText size={16} colour={nebula.onAccent}>
              {chosen
                ? t("nebulaCommon:app.connectAs", { name: chosen.name })
                : t("nebulaCommon:app.connect")}
            </DisplayText>
          </PlateButton>

          <Stack direction="row" alignItems="center" gap={1.375}>
            {/* A switch drawn from the pack's own corners rather than MUI's
                capsule: on a skin that squares everything, a pill here is the
                one rounded thing on the screen. */}
            <Box
              component="button"
              type="button"
              role="switch"
              aria-checked={model.autoConnect}
              onClick={() => model.onAutoConnectChange(!model.autoConnect)}
              data-testid="nebula-mobile-autoconnect"
              sx={{
                all: "unset",
                boxSizing: "border-box",
                cursor: "pointer",
                flex: "none",
                width: 48,
                height: 27,
                display: "flex",
                alignItems: "center",
                justifyContent: model.autoConnect ? "flex-end" : "flex-start",
                p: "2px",
                background: model.autoConnect ? nebula.accent : nebula.card2,
                border: `var(--nebula-line-width, 1px) solid ${
                  model.autoConnect ? nebula.accent : nebula.line2
                }`,
                borderRadius: radius("pill"),
              }}
            >
              <Box
                sx={{
                  width: 19,
                  height: 19,
                  background: model.autoConnect ? nebula.onAccent : nebula.dim,
                  borderRadius: radius("pill"),
                }}
              />
            </Box>
            <Box
              sx={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: nebula.muted,
              }}
            >
              {t("nebulaCommon:app.autoConnect")}
            </Box>
          </Stack>
        </Stack>
      </Box>
    </>
  );
}
