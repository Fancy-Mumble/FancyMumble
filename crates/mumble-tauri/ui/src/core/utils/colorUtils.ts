/**
 * Profile colour maths.
 *
 * Lives in the shared profile-card package because the standalone channel
 * viewer paints the same cards from the same stored profiles; this module is
 * the client's import path for it and adds nothing of its own.
 */
export * from "@shared/profilecard/color";
