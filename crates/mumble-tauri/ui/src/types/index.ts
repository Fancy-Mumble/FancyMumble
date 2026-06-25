/** Lightweight value types mirroring the Rust backend structs.
 *
 *  This is a barrel: the types are organised into per-domain modules in this
 *  folder, and re-exported here so existing `import { Foo } from "../types"`
 *  sites keep working unchanged. Add new types to the matching domain module
 *  (or a new one), not to this file - it should only ever list re-exports.
 */

export * from "./chat";
export * from "./server";
export * from "./embed";
export * from "./fileserver";
export * from "./livedoc";
export * from "./plugins";
export * from "./preferences";
export * from "./audio";
export * from "./stats";
export * from "./search";
export * from "./profile";
export * from "./pchat";
export * from "./admin";
export * from "./onboarding";
export * from "./serversettings";
