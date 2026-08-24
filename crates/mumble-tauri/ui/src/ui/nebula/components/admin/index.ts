// `AdminScreen` is loaded lazily by `NebulaClientApp` and so is not
// re-exported: this barrel is imported for the capability hooks, which
// every session needs, and re-exporting the screen would drag all fourteen
// administration pages along with them.
export {
  useAdminCapabilities,
  useAdminNavEntries,
  type AdminCapabilities,
  type AdminPageId,
} from "./capabilities";
