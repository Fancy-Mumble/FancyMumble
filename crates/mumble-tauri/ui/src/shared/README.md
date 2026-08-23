# Shared

Code that is not the desktop client's alone.

Everything under `src/shared` is written to be mounted by two hosts: this
client, and the standalone channel viewer (`channelviewer-frontend`). That
constraint is the whole design rule here - nothing in this directory may import
from `@core`, `@ui` or any UI pack, and nothing may reach for a dependency the
viewer does not have.

## profilecard

The profile card: one component, painted from one resolver, filled by whichever
host is mounting it.

- `ProfileCard.tsx` - the card. Plain React, inline styles and one injected
  stylesheet for the states inline styles cannot express. No MUI: the client is
  on MUI 9 and the viewer on MUI 6, and a card built on either would be a card
  only one of them could mount. No icon package either - `icons.tsx` inlines the
  dozen glyphs it needs.
- `model.ts` - `ProfileCardModel`, everything a card can be told about a person,
  plus the badge arrangement rules. Hosts fill in what they know and leave out
  what they do not; the card draws the rows it was given.
- `paint.ts` - a stored `FancyProfile` resolved into the slots the card paints
  from: card, banner, avatar ring, nameplate, sticker, send button, text ramp.
- `placement.ts` - where a card goes relative to the row it is about. Beside it,
  centred on it, flipping and clamping rather than overflowing.
- `tokens.ts` - the ten colour slots a host lends the card, so an unstyled card
  looks like part of the app it is floating in.
- `catalog.ts`, `color.ts`, `profileFormat.ts`, `profileTypes.ts`, `tint.ts` -
  the profile domain the card resolves against. The client re-exports these from
  their historical paths (`@core/utils/colorUtils`, `@core/profileFormat`,
  `@core/types`, `@core/features/settings/profileData`), so nothing else in the
  client had to change when they moved here.

### Badges

Badges are the server's to grant. Today the only grant a Mumble server makes is
group membership, so that is what a badge is minted from - `badgeFromGroup` -
and groups already travel with a colour and free-form metadata. That metadata is
the opening the server-managed catalogue arrives through: `badge_icon`,
`badge_label`, `badge_shelf`, `badge_shelf_label`, `badge_shape`, `badge_color`,
`badge_emoji`, `badge_hidden`. A server that starts sending them gets glyphs,
shelves and tiers with no client release. Live voice flags (priority speaker,
muted, deafened) are minted separately and marked `source: "state"`, so a mute
that lasts thirty seconds can never push a granted badge off the visible strip.

### Keeping the two copies identical

The viewer is a separate repository, so there is no import path between them.
The client's copy is the source; `scripts/sync-profile-card.sh` in the e2e repo
copies it across, and `--check` fails when they have diverged. Edit the card
here, never in the viewer's `src/shared`.
