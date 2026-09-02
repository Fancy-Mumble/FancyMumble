/**
 * Which form control a server setting asks for.
 *
 * The form is built from the schema the server advertises rather than written
 * out in each UI, so this is the one place a declared type turns into a
 * decision about what to render - and the one place the fallback for a server
 * that declares nothing useful lives. Three UIs render this form; a rule copied
 * into each of them is a rule that ends up meaning three different things.
 */

import type { ServerSetting } from "../../types";

/**
 * Keys and labels that name a setting whose value has always been HTML.
 *
 * A guess, and only reached when the server has not said. Starling declares
 * `html` (`Setting.Kind.HTML`), so this is what covers the epoch-0 fork, which
 * has one type string for "several lines" and no way to say "and it is markup".
 *
 * Matched against the label as well as the key because a plugin is free to name
 * its own setting, and `motd` is what half of them call this.
 */
const RICH_TEXT_SETTING = /welcome|motd/i;

/**
 * Whether `setting` should be edited as formatted text rather than as source.
 *
 * True when the server said so, and - failing that - when the setting is
 * multi-line and named like the one setting that has always been markup.
 *
 * Getting this wrong is visible either way round: a plain-text setting in a
 * WYSIWYG field gets `<p>` wrapped around it the first time it is touched, and
 * an HTML one in a plain field shows an operator the tags they are writing
 * between.
 */
export function isRichTextSetting(setting: Readonly<ServerSetting>): boolean {
  if (setting.type === "html") return true;
  if (setting.type !== "text") return false;
  return RICH_TEXT_SETTING.test(`${setting.key} ${setting.label}`);
}
