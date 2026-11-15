# The profile format: "about" and the full profile

A user's Mumble comment starts with `<!--FANCY:{json}-->`; what follows is
HTML. Until now that HTML was the "bio" and the only place a profile's text
lived. Drawing it meant an HTML reader and layout for every card, and every
picture pasted into it travelled inside the comment as a `data:` address, so
opening a card meant fetching, holding and decoding all of them.

The new format moves the text into the profile JSON as a short, bounded list
of typed blocks ("about"), keeps pictures there only as small thumbnails, and
puts anything large into a second, separately fetched document ("page").
The code is `src/ui/tauri/src/engine_api/about/` (shared by both
clients); this client reads it in `src/profile.rs` and draws it in
`src/ui/about_view.rs`, `src/ui/card.rs` and `src/ui/profile_page.rs`.

## The three tiers

| Tier | Where | Fetched | Holds |
| --- | --- | --- | --- |
| Card | `about` in the profile JSON | with the comment | text blocks, thumbnails |
| Plain HTML | after the mark | with the comment | generated from `about`, for other clients |
| Full profile | `page` = a file in the server's file store | only on "View full profile" | long text, galleries, links |

Nothing in any tier is fetched from a third party. A link is opened only
after the reader is asked, as everywhere.

## `about`

```json
"about": { "v": 1, "blocks": [
  { "t": "h", "x": "Quotes", "a": "c" },
  { "t": "p", "a": "c", "r": [ { "x": "Hello World!", "b": true } ] },
  { "t": "p", "a": "c", "r": [ { "x": "Morgens halb acht", "l": "https://example.org/x" } ] },
  { "t": "list", "a": "c", "i": [ [ { "x": "Make the world more exciting" } ],
                                  [ { "x": "うるさい" } ] ] },
  { "t": "quote", "r": [ { "x": "said once", "i": true } ] },
  { "t": "hr" },
  { "t": "pics", "p": [ { "d": "data:image/jpeg;base64,/9j/…", "w": 1920, "h": 1280,
                          "k": "0/0193b7…/sunset.jpg", "n": 1843200, "alt": "Sunset" } ] }
] }
```

- **Blocks** (`t`): `h` heading, `p` text, `list` (`n: true` numbers it; one
  level), `quote`, `hr` divider, `pics` a row of pictures. `a` aligns a block:
  `l` (left, the default, left out), `c`, `r`.
- **Runs** (`r`, and each list item): `x` the text (a line break is `\n`),
  then any of `b` bold, `i` italic, `u` underline, `s` struck, `c` code, and
  `l` a link (`http`/`https` only).
- **Pictures**: `d` the thumbnail as a `data:` address, `w`/`h` the full
  picture's size, `k` the key of the full picture in the server's file store
  and `n` its bytes (both optional), `alt`.
- **Unknown** block kinds, run fields and picture fields are skipped, one
  at a time: a block that does not read is dropped, not the profile. `v`
  says which version wrote it; a change a reader must understand gets a new
  field name instead of a new `v`.
- **Bounds**, enforced by every reader (what is past them is not drawn) and
  every writer (refused): 32 blocks; 3000 characters of text in all; 48 runs
  a block; 12 list items; 6 pictures, 3 a row; a thumbnail at most 4096 bytes
  and 160 pixels a side; 12288 bytes of thumbnails in all; a link 1024
  characters; a key 256.

**Pictures are sized to the server.** Starling counts the *whole* comment
against `text_message_length` (5000 bytes by default; murmur counts it
without `<img>` data, but the JSON still counts). Comments of 128 bytes or
more are fetched by hash when a card opens. So the writer makes thumbnails
to fit: JPEG, 160 px down to 64 px, quality 70 down to 40, each within its
share of what is left; if the comment still does not fit, thumbnails are
dropped (largest first, the key to the full picture kept), and only then is
saving refused with the limit named.

## The plain HTML after the mark

Generated from `about`, never edited by hand: `p`, `br`, `strong`, `em`,
`u`, `a`, and `span style` for struck text, code and alignment. That is
exactly what today's web client lets through (`bioSanitize.ts`), and plain
Mumble draws all of it. A heading is a bold line, a list `• item` lines, a
quote `“…”` in italics, a divider `———`. **No pictures**: they would cost
the comment twice, and plain clients show the text well without them.

## The older format

A profile whose JSON has no `about` is "the older format". A card says so in
one quiet line and draws only text, line breaks, bold, italic, underline,
links and simple lists, read by `src/rich.rs` with pictures neither decoded
nor kept; no tables, colours, sizes or alignment. The HTML is not held after
that reading. A comment with no profile mark at all (another client's) is
read the same way, without the line.

**Migration** (`about::Migration`, engine crate): `p`/`div` become text
blocks (alignment from `text-align` or `align`), `br` a line break,
`strong b em i u s strike del code` marks, `a` links (http/https only), `h1`
to `h6` headings, `ul`/`ol`/`li` lists (deeper lists flattened into the
first level), `blockquote` quotes, `hr` dividers, each `data:` picture a
thumbnail in a row with its neighbours. Colours, sizes, fonts, tables and
anything else keep their text and lose their setting. Only the owner
converts, from their own card, after a preview beside the old one; nothing
is ever converted silently or for somebody else.

## `page`: the full profile

```json
"page": { "k": "0/0193b7…/profile.json", "n": 5123, "v": 1 }
```

A JSON document in the server's file store, fetched only when somebody
presses "View full profile", and let go of when its view closes:

```json
{ "v": 1, "sections": [
  { "t": "text", "title": "About", "blocks": [ … as in about … ] },
  { "t": "gallery", "title": "Pictures", "p": [ … pictures, each with k … ] },
  { "t": "links", "title": "Elsewhere", "links": [ { "x": "Blog", "l": "https://…" } ] }
] }
```

Section kinds now: `text` (blocks, 20000 characters, 128 blocks), `gallery`
(24 pictures, thumbnails up to 8192 bytes, full picture by `k` on a click),
`links` (24). Unknown kinds are skipped. A page is at most 256 KiB; a client
refuses a larger one, and one whose size differs from `n`. The view draws
sections by kind, so the page renderer can take over a kind later.

**The file store can serve this, with limits.** Files go to the root
channel (`0/…`), shared "with those here". Who may read: anybody who may
enter the root channel (normally everybody on the server). Who may write:
somebody with Share files there; otherwise the option fails with the
server's refusal. Lifetime: kept until deleted, unless the operator caps
file lifetimes (`max_ttl_seconds`); then the page goes after that, and the
card says the full profile is no longer there. A key means something only
on the server that issued it. The files show in the owner's own file list,
where deleting one breaks the profile's reference. A server without a file
store is not offered a page or stored pictures.

## Choices the user may want to make differently

- No pictures in the plain HTML (other clients see text only).
- The older-format line only for profiles that carry a Fancy mark.
- Conversion keeps alignment per block, not per line inside a paragraph.
- Converting with "keep the full pictures here" also writes a page: the
  whole text (if the card had to cut it) and a gallery of the pictures.
- Thumbnails are JPEG; transparency is flattened onto grey.
- Files live in the root channel; a server whose root denies Enter to
  somebody hides the page from them.
