import "./global.css";
import { initializeStandardAppearance } from "./appearance";
import { followPageSystemBars } from "@core/systemBars";

initializeStandardAppearance();
// Nebula styles its bars from its MUI theme; Standard themes through CSS, so
// it follows whatever the page ends up painting.
followPageSystemBars();

/** The existing interface remains an independent, supported UI pack. */
export { default } from "./App";
