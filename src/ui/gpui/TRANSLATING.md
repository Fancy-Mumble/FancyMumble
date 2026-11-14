# Translating fancy-gpui

The view says everything in English unless another language is chosen
(Settings, Language & format). Every word it shows is asked for in one
place, `src/words/`, and nothing there can be missing: the English is
written where the word is used, and is said whenever a language has no
words for it. A missing translation shows English, never a key.

## How a view asks for words

```rust
use crate::words::t;

t!("Text size")                                          // a text
t!("The picture could not be kept: {{error}}", error = error)  // with a value
t!("{{count}} file", "{{count}} files", count = files)   // with a count
```

- `t!` returns a `SharedString`, which every kit part takes.
- The English is the key. Write it exactly as it should read in English.
- Values go in as `{{name}}`, the way the web client's files write them.
  Anything that displays can be given; the macro takes them by name.
- For a count, give the English for one and for any other number. A
  language keys it by the second, and has as many forms as it needs
  (`one`, `few`, `many`, `other`...), chosen by Unicode's plural rules
  (`icu_plurals`). The count is put in as `{{count}}`.
- Ask for words while drawing (`render`, or the functions it calls), not
  when a view is built: words asked for in `new` stay in the language they
  were asked in. Changing the language draws every window again
  (`Shell::set_language`), so words asked for while drawing follow it.
- Ask on the UI thread. The language belongs to the thread that draws, so
  that each test has its own; a background thread would be told English.
- Names of people, channels and servers, messages, and what a server sends
  are not translated. Neither are selectors, icon names or log lines.

`src/ui/settings/` is converted; read it as the example.

## Where the words come from

For a language other than English, in this order:

1. **This client's own file**, `locales/<code>.json`: what this client
   says in its own way. One JSON object; each key is the English as `t!`
   writes it, each value its translation, or for a count an object of
   plural forms:

   ```json
   {
     "Washed out": "Verblasst",
     "{{count}} files": { "one": "{{count}} Datei", "other": "{{count}} Dateien" }
   }
   ```

2. **The web client's files**, for wording both clients share. They are
   read where they are, `crates/mumble-tauri/ui/src/core/locales/`
   (`common/` and `nebula/`), compiled in, never copied.
   `locales/shared.json` says which key of theirs means the same as which
   English of ours:

   ```json
   { "Text size": "nebulaSettings:personalize.textSize" }
   ```

   The namespace is the web client's: `settings` is
   `common/<code>/settings.json`, `nebulaSettings` is
   `nebula/<code>/settings.json`. A key with plural forms there
   (`readoutHold_one`, `readoutHold_other`) is named without the suffix.

3. **English**, as written in the source.

The own file wins over the web client's. Use that where the web client's
word does not fit this client: its German says "Sprache" both for voice and
for language, so `de.json` says "Audio" for "Voice".

### Which to use for a new string

- If the web client says **exactly** the same English, with the same
  meaning, add it to `shared.json`. One translation then serves both
  clients, and improves for both.
- Otherwise (this client words it differently, or the web has no such
  string) add it to each `locales/<code>.json`. Until a language has it,
  that language shows the English.

The tests hold the data to this:

| Test (`cargo test words`) | What it holds |
| --- | --- |
| `every_shared_wording_means_in_english_what_this_client_says` | each `shared.json` key resolves, in the web client's English, to exactly our English |
| `every_shared_wording_is_there_in_every_language` | each such key exists in every language's web files |
| `every_translation_keeps_the_values_its_english_has` | a translation has the same `{{names}}` as its English |
| `every_translation_is_of_something_the_view_says` | every key in our files is a `t!` somewhere in `src/` (nothing left over after English changes) |
| `every_word_on_the_settings_page_is_asked_for` | no sentence-like literal in `settings/` bypasses `t!` |
| `every_word_on_the_settings_page_is_there_in_every_language` | German, French and Chinese have every word of that page |

When the English of a string changes, its translations no longer match;
the fourth test names them. Move them to the new English, or drop them.

## Adding a language

1. Add it to `Language` in `src/words/language.rs`: a variant, its code
   (the web client's folder name, `es`), and its name in itself
   (`Español`). It is offered in the settings from then on.
2. Write `locales/<code>.json` with this client's own words.
3. If the web client has the language, `shared.json` already brings its
   share; `every_shared_wording_is_there_in_every_language` says which keys
   it lacks.

Plural rules come with `icu_plurals` for every language Unicode knows.

## Trying a language

`FANCY_GPUI_LANGUAGE=de` starts in that language whatever is kept, as
`FANCY_GPUI_THEME` does for a theme:

```powershell
$env:FANCY_GPUI_ENGINE="demo"; $env:FANCY_GPUI_DEMO="connected"
$env:FANCY_GPUI_LANGUAGE="de"; $env:FANCY_GPUI_OPEN="settings"
target\release\fancy-gpui.exe
```

## What is left to convert

Sentence-like string literals per file (a literal that begins with a
capital letter, outside tests, comments, log lines and `expect` messages),
counted on 2026-11-14. A rough measure for planning, not a contract: it
misses lower-case fragments and counts some that are not words of the view.

| File | Strings | Note |
| --- | ---: | --- |
| `src/ui/settings/` | 0 | converted |
| `src/ui/menu.rs` | 138 | menus and the questions they ask; split it first |
| `src/demo.rs` | 43 | made-up server content: **do not translate** |
| `src/ui/acl.rs` | 42 | permission names; look for the web's before writing our own |
| `src/real.rs` | 30 | engine errors shown as notices; check which reach the view |
| `src/ui/conversation.rs` | 25 | |
| `src/ui/channel_form.rs` | 24 | |
| `src/ui/sidebar.rs` | 24 | |
| `src/ui/devices.rs` | 0 | converted (the voice panel over the tile) |
| `src/ui/staged.rs` | 18 | |
| `src/sounds.rs` | 17 | event names, shown inside the settings page (Notifications) |
| `src/ui/server_editor.rs` | 17 | |
| `src/ui/connect.rs` | 16 | |
| `src/ui/actions.rs` | 15 | |
| `src/theme.rs` | 14 | theme names from the web's catalogue; check whether the web translates them |
| `src/ui/ban_editor.rs` | 14 | |
| `src/ui/card.rs` | 14 | |
| `src/ui/about.rs` | 13 | |
| `src/ui/format_bar.rs` | 13 | |
| `src/ui/admin.rs` | 12 | |
| `src/ui/certificates.rs` | 12 | |
| `src/ui/emoji.rs` | 12 | group names: `emojis` has English only |
| `src/ui/embeds.rs` | 9 | |
| `src/tray.rs` | 8 | |
| `src/ui/mod.rs` | 8 | notices |
| `src/ui/accounts.rs` | 7 | |
| `src/ui/lightbox.rs` | 7 | |
| `src/ui/pins.rs` | 7 | |
| `src/assets.rs` | 6 | font names: **do not translate** |
| `src/main.rs` | 6 | window title and start-up |
| `src/picture.rs` | 6 | |
| `src/ui/later.rs` | 6 | also parses `15m`, `2h`: keep the parser English |
| `src/bans.rs` | 5 | |
| `src/ui/links.rs` | 5 | |
| `src/ui/rail.rs` | 5 | |
| `src/ui/reconnect.rs` | 5 | |
| `src/ui/speaker.rs` | 5 | |
| `src/ui/text_input.rs` | 5 | |
| `src/ui/band.rs` | 4 | |
| `src/ui/friends.rs` | 4 | |
| `src/ui/keys.rs` | 4 | key names |
| `src/ui/members.rs` | 4 | |
| `src/ui/picker.rs` | 0 | converted |
| `src/pictures/scaled.rs` | 3 | |
| `src/ui/mover.rs` | 3 | |
| `src/ui/sounds.rs` | 0 | its page is in `settings/` now |
| `src/hotkeys.rs` | 2 | |
| `src/notify.rs` | 2 | |
| `src/paths.rs` | 2 | |
| `src/ui/acl_people.rs` | 2 | |
| `src/ui/marking.rs` | 2 | |
| `src/ui/widgets.rs` | 2 | |
| `src/profile.rs` | 1 | |
| everything else | 0 | |

About 630 to go, without `demo.rs` and `assets.rs`. Times and dates
(`chrono`) are still written the English way; the web client formats them
with the language (`Intl`), which is a separate step.
