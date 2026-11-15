/**
 * The app's monogram, as an outline.
 *
 * GENERATED - do not edit by hand. Remake it with:
 *
 *     python tools/extract-glyph.py <font.ttf> F src/core/brandGlyph.ts
 *
 * The capital F of GreatVibes-Regular.ttf, lifted out of the font so that the font itself does
 * not have to ship. Drawing one glyph is not worth half a megabyte, an
 * `@font-face` and a loading race - canvas draws with whatever face happens to
 * be ready and says nothing when that is the wrong one. An outline is data in
 * the bundle: it cannot arrive late and it cannot be substituted.
 *
 * Great Vibes is under the SIL Open Font Licence 1.1 and declares no Reserved
 * Font Name, so this derivative is permitted; the licence travels beside this
 * file as `brandGlyph-OFL.txt`.
 *
 * The path is plain geometry - no colour, no background, no size. It is drawn
 * in a y-down space with the ink box at the origin, so a consumer either sets
 * `viewBox="0 0 1391 844"` or scales it into whatever box it has.
 */

/** The outline, as SVG path data. */
export const BRAND_GLYPH_PATH =
  "M362 844Q252 844 170.5 810Q89 776 44.5 716.5Q0 657 0 581Q0 519 22 468Q44 417 80.5 383Q117 349 161 338Q168 337 168 343Q168 348 163 351Q111 382 83.5 440Q56 498 56 569Q56 646 96 701.5Q136 757 205.5 786.5Q275 816 362 816Q437 816 504.5 789.5Q572 763 629 717Q686 671 731.5 612.5Q777 554 808 490Q815 475 822 461Q829 447 836 433Q812 432 792.5 431Q773 430 766 430Q739 430 708.5 433.5Q678 437 651.5 447Q625 457 608 478Q601 485 599.5 489Q598 493 595 493Q591 493 588 486.5Q585 480 589 472Q612 421 654 402.5Q696 384 748 384Q759 384 789.5 387.5Q820 391 854 395Q898 306 934.5 234Q971 162 1003 114Q931 90 850 71.5Q769 53 676 53Q607 53 551 72Q495 91 455.5 123Q416 155 395 194Q374 233 374 272Q374 316 391 342Q408 368 435.5 379.5Q463 391 492 391Q535 391 565.5 370Q596 349 614 322.5Q632 296 636 279Q640 263 648 263Q660 263 658 277Q652 321 627 353Q602 385 566 401.5Q530 418 490 418Q449 418 411 398Q373 378 349 340Q325 302 325 248Q325 204 344.5 160.5Q364 117 403.5 80.5Q443 44 504 22Q565 0 648 0Q707 0 769 13.5Q831 27 894.5 47.5Q958 68 1020 90Q1041 63 1060 48.5Q1079 34 1098 34Q1106 34 1109 37.5Q1112 41 1112 44Q1112 48 1109 53Q1106 58 1098 58Q1065 58 1036 95Q1108 119 1174.5 137.5Q1241 156 1298 156Q1342 156 1356 146.5Q1370 137 1370 120Q1370 109 1377 109Q1382 109 1386.5 115.5Q1391 122 1391 131Q1391 155 1364.5 170Q1338 185 1291 185Q1229 185 1162 164.5Q1095 144 1020 119Q993 164 967 236.5Q941 309 906 400Q949 404 997 406.5Q1045 409 1075 409Q1085 409 1085 415Q1085 423 1062 429Q1047 433 1011.5 435Q976 437 938 437Q930 437 918 436.5Q906 436 892 436Q883 459 873.5 482.5Q864 506 853 531Q811 630 750.5 691.5Q690 753 621.5 786.5Q553 820 485.5 832Q418 844 362 844Z";

/** The ink box the path is drawn in. Nothing falls outside it. */
export const BRAND_GLYPH_WIDTH = 1391;
export const BRAND_GLYPH_HEIGHT = 844;
