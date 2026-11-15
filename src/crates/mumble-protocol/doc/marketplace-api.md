# Fancy Mumble Plugin Marketplace REST API

> Specification for the public plugin marketplace consumed by
> Fancy Mumble admin clients (and indirectly by Fancy Mumble servers
> when installing a plugin on behalf of an admin).
>
> Status: **draft v1**.  Base URL: `https://plugins.fancy-mumble.com/api/v1`.

## Goals

- Let an admin browse, search, and install plugins from inside the
  Fancy Mumble client UI without leaving the app.
- Distribute plugin binaries as the same drop-in archive layout that
  the upstream `fancy-plugin` repository CI already produces (see
  `fancy-plugin/.github/workflows/ci.yml`), so plugin authors do not
  need a separate build pipeline to publish.
- Provide enough metadata (per-OS, per-arch download URLs + SHA-256
  checksums) for the server to **verify** the archive before extracting
  it into the plugins directory.

## High-level flow

1. Client UI (`MarketplaceTab`) calls
   `fetch_marketplace_index` (Tauri command) which hits
   `GET /plugins?query=...&page=...`.
2. The Tauri layer returns the JSON `MarketplaceIndex` directly to the
   React component, which renders the cards.
3. When the admin clicks **Install**, the UI calls
   `install_server_plugin` which sends a `FancyPluginAdminInstall`
   protobuf message to the Mumble server.
4. The Fancy Mumble **server** then resolves the manifest URL itself:
   - Fetches `GET /plugins/{id}/versions/{version}/manifest`.
   - Picks the artifact matching the server's `(os, arch)`.
   - Downloads the ZIP / tarball.
   - Verifies the `sha256` from the manifest.
   - Extracts the cdylib + INI snippet into the configured plugins
     directory.
   - Writes `plugin.<name>.enabled = true` into the server config.
   - Hot-loads the plugin (no server restart required).
5. The server replies with a `FancyPluginAdminAck` (or a
   `FancyPluginAdminList` broadcast on success) and the UI shows a
   toast.

The marketplace is therefore **only** consumed by the Tauri client
(for browsing) and by the Mumble server (for downloading + verifying).
No secrets are exchanged; all reads are unauthenticated.

---

## Endpoints

### `GET /plugins`

List or search the marketplace catalogue.

#### Query parameters

| Name       | Type    | Default | Description |
|------------|---------|---------|-------------|
| `query`    | string  | `""`    | Case-insensitive fuzzy match against `name`, `description`, `tags`, `author`. |
| `os`       | enum    | -      | Filter to artifacts present for this OS: `linux`, `windows`, `macos`. |
| `arch`     | enum    | -      | Filter to artifacts present for this architecture: `x86_64`, `aarch64`. |
| `page`     | uint    | `1`     | 1-based page index. |
| `per_page` | uint    | `24`    | Page size, max `100`. |
| `sort`     | enum    | `popular` | `popular`, `recent`, `name`, `downloads`, `rating`. |
| `official` | bool    | -      | When `true`, restrict to plugins flagged `official`. |

#### Response 200

```json
{
  "plugins": [ /* MarketplacePlugin[] */ ],
  "total": 137,
  "page": 1,
  "per_page": 24
}
```

### `GET /plugins/{id}`

Returns the full `MarketplacePlugin` record for a single plugin.

#### Response 200

A `MarketplacePlugin` (schema below) with the additional fields
`versions: VersionRef[]` and `readme: string` (rendered Markdown).

#### Response 404

```json
{ "error": "plugin_not_found" }
```

### `GET /plugins/{id}/versions`

Lists every published version, newest first.

#### Response 200

```json
{
  "plugin_id": "fancy-greeter",
  "versions": [
    {
      "version": "0.4.1",
      "released_at": "2025-04-18T12:30:00Z",
      "yanked": false,
      "min_server_version": "1.6.0",
      "min_fancy_server_version": "0.5.0",
      "changelog": "..."
    }
  ]
}
```

### `GET /plugins/{id}/versions/{version}/manifest`

Returns the install manifest.  **This is the only document the server
needs to perform the install.**

#### Response 200

```json
{
  "plugin_id": "fancy-greeter",
  "name": "Fancy Greeter",
  "version": "0.4.1",
  "released_at": "2025-04-18T12:30:00Z",
  "license": "MIT",
  "homepage": "https://github.com/Fancy-Mumble/fancy-plugin",
  "source_url": "https://github.com/Fancy-Mumble/fancy-plugin",
  "min_server_version": "1.6.0",
  "min_fancy_server_version": "0.5.0",
  "ini_snippet": "; Optional INI keys appended to mumble-server.ini\n; plugin.fancy-greeter.greeting = Hello!\n",
  "artifacts": [
    {
      "os": "linux",
      "arch": "x86_64",
      "format": "tar.gz",
      "download_url": "https://plugins.fancy-mumble.com/files/fancy-greeter/0.4.1/fancy-greeter-linux-x86_64.tar.gz",
      "sha256": "9f4a...e2c1",
      "size_bytes": 482113,
      "cdylib_filename": "libfancy_greeter.so"
    },
    {
      "os": "linux",
      "arch": "aarch64",
      "format": "tar.gz",
      "download_url": "https://.../fancy-greeter-linux-aarch64.tar.gz",
      "sha256": "...",
      "size_bytes": 471882,
      "cdylib_filename": "libfancy_greeter.so"
    },
    {
      "os": "macos",
      "arch": "aarch64",
      "format": "tar.gz",
      "download_url": "https://.../fancy-greeter-macos-aarch64.tar.gz",
      "sha256": "...",
      "size_bytes": 504219,
      "cdylib_filename": "libfancy_greeter.dylib"
    },
    {
      "os": "windows",
      "arch": "x86_64",
      "format": "zip",
      "download_url": "https://.../fancy-greeter-windows-x86_64.zip",
      "sha256": "...",
      "size_bytes": 532001,
      "cdylib_filename": "fancy_greeter.dll"
    }
  ]
}
```

### `GET /plugins/{id}/versions/{version}/download`

Convenience redirect that picks the artifact for the requested
`(os, arch)` and returns `302 Found` to the storage URL.  Useful for
direct browser downloads and `curl -LO` flows.

#### Query parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `os` | enum | yes | `linux`, `windows`, `macos` |
| `arch` | enum | yes | `x86_64`, `aarch64` |

#### Responses

- `302 Found` with `Location:` pointing at the storage URL.
- `404` `{ "error": "artifact_not_found" }` if no artifact matches.

### `GET /healthz`

Returns `200 OK` with `{ "status": "ok" }` for uptime checks.

---

## Schemas

### `MarketplacePlugin`

```json
{
  "id": "fancy-greeter",
  "name": "Fancy Greeter",
  "slug": "fancy-greeter",
  "version": "0.4.1",
  "description": "Sends a configurable welcome message to every user that joins the server.",
  "author": "Fancy Mumble Team",
  "homepage": "https://github.com/Fancy-Mumble/fancy-plugin",
  "icon_url": "https://plugins.fancy-mumble.com/icons/fancy-greeter.png",
  "manifest_url": "https://plugins.fancy-mumble.com/api/v1/plugins/fancy-greeter/versions/0.4.1/manifest",
  "downloads": 12384,
  "rating": 4.7,
  "official": true,
  "tags": ["welcome", "chat", "greeting"],
  "capabilities": ["text", "events"]
}
```

| Field          | Type      | Notes |
|----------------|-----------|-------|
| `id`           | string    | Stable identifier (slug).  Must match the cdylib base name. |
| `name`         | string    | Human-readable display name. |
| `slug`         | string    | URL-safe slug, equal to `id` today (reserved for renames). |
| `version`      | semver    | Latest published version. |
| `description`  | string    | One-line description. |
| `author`       | string    | Optional. |
| `homepage`     | url       | Optional. |
| `icon_url`     | url       | Optional 256x256 PNG. |
| `manifest_url` | url       | Latest version's manifest endpoint. |
| `downloads`    | integer   | Lifetime download count.  Optional. |
| `rating`       | float     | 0.0-5.0, average user rating.  Optional. |
| `official`     | bool      | Maintained by the Fancy Mumble project. |
| `tags`         | string[]  | Free-form tags for search. |
| `capabilities` | string[]  | Subset of `mumble-plugin-api` capability names (`text`, `audio_in`, `events`, ...). |

### `MarketplaceIndex`

```json
{
  "plugins": [ /* MarketplacePlugin */ ],
  "total": 137,
  "page": 1,
  "per_page": 24
}
```

### `VersionRef`

```json
{
  "version": "0.4.1",
  "released_at": "RFC3339",
  "yanked": false,
  "min_server_version": "1.6.0",
  "min_fancy_server_version": "0.5.0",
  "changelog": "Markdown"
}
```

### `Artifact`

| Field             | Type    | Description |
|-------------------|---------|-------------|
| `os`              | enum    | `linux`, `windows`, `macos`. |
| `arch`            | enum    | `x86_64`, `aarch64`. |
| `format`          | enum    | `tar.gz` (Linux/macOS) or `zip` (Windows), matching the [fancy-plugin CI archive layout](#archive-layout). |
| `download_url`    | url     | HTTPS URL for the artifact. |
| `sha256`          | string  | Hex-encoded SHA-256 of the artifact.  Servers MUST verify this before extracting. |
| `size_bytes`      | integer | Exact byte size. |
| `cdylib_filename` | string  | File inside the archive that the server should load (`lib<name>.so`, `<name>.dll`, `lib<name>.dylib`). |

---

## Archive layout

The marketplace distributes the **same drop-in archives** that the
upstream `fancy-plugin` repository's CI workflow already builds.  The
contents of each archive are:

```
lib<name>.so   |  <name>.dll  |  lib<name>.dylib   <- plugin cdylib
plugin.example.ini                                 <- snippet appended to mumble-server.ini
README.md                                          <- full documentation
```

Optional extras (forward-compatible, ignored by the server today):

```
LICENSE
manifest.json     <- per-archive verbatim copy of /versions/{ver}/manifest
icon.png
```

Linux + macOS use `tar.gz`, Windows uses `zip`.  The format is
declared in `Artifact.format` so the server picks the correct
extractor.

### Server install procedure

1. `GET` the artifact's `download_url`.
2. Verify the on-the-wire `Content-Length` matches `size_bytes`.
3. Stream-hash the response with SHA-256.
4. Reject the install if the hash differs from `Artifact.sha256`.
5. Extract `cdylib_filename` into `{plugins_dir}/{cdylib_filename}`.
6. Extract `plugin.example.ini` and append/merge the keys into
   `mumble-server.ini`, scoped under `plugin.<id>.*`.
7. Write `plugin.<id>.enabled = true`.
8. Notify the plugin host to hot-load the new cdylib.
9. Broadcast a fresh `FancyPluginAdminList` to all admins.

If any step fails, the server replies with `FancyPluginAdminAck { ok:
false, error: "...", verb: INSTALL }` and rolls back any partially
written files.

### Server uninstall procedure

1. Unload the cdylib via the plugin host (`Entry::drop` triggers
   `on_unload`).
2. Delete `{plugins_dir}/{cdylib_filename}`.
3. Remove `plugin.<id>.*` keys from `mumble-server.ini`.
4. Reply with `FancyPluginAdminAck { ok: true, verb: UNINSTALL }`.
5. Broadcast a fresh `FancyPluginAdminList`.

---

## Caching and rate limits

- Index and manifest responses SHOULD include `Cache-Control: public,
  max-age=300, s-maxage=300`.  Clients MAY cache them for up to five
  minutes.
- Artifact storage URLs SHOULD set `Cache-Control: public, max-age=31536000, immutable`
  because version+sha256 is content-addressed.
- Unauthenticated clients are limited to **60 requests / minute** per
  IP for `GET /plugins` and `GET /plugins/{id}`; manifest and
  download routes are unmetered (they're CDN-cached).

## Versioning

- The API path is prefixed with `/api/v1`.  Breaking changes go to
  `/api/v2`.
- The `MarketplacePlugin`, `Artifact`, and manifest schemas are
  forward-compatible: clients MUST ignore unknown fields.
- New OS / arch values may appear; clients that don't recognise a
  value SHOULD skip the artifact (do not fail-hard).

## Error model

All non-2xx responses return JSON:

```json
{
  "error": "machine_readable_code",
  "message": "Human-readable explanation."
}
```

| Code                   | HTTP | Meaning |
|------------------------|------|---------|
| `plugin_not_found`     | 404  | Unknown plugin id. |
| `version_not_found`    | 404  | Plugin exists but the requested version does not. |
| `artifact_not_found`   | 404  | Manifest has no artifact matching the requested `(os, arch)`. |
| `rate_limited`         | 429  | Slow down. |
| `internal_error`       | 500  | Unexpected failure. |

---

## Open questions (not blocking v1)

- Signing: future versions may add a detached signature
  (`Artifact.signature`) signed by the plugin author's key.  v1 trusts
  TLS + SHA-256.
- Authenticated publishing: out of scope for this document - the
  publishing pipeline is internal to the marketplace operators.
- Per-user ratings / reviews: the `rating` field is exposed but the
  submission API is not part of v1.
