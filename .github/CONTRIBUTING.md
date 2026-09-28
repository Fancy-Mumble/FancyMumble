# Contributing to Fancy Mumble

Thank you for considering contributing to Fancy Mumble! This document
explains how to get started.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating you agree to abide by its terms.

## Getting Started

1. **Fork** the repository and clone your fork.
2. Install prerequisites (see [README](../README.md#prerequisites)).
3. Create a feature branch: `git checkout -b feat/my-feature`
4. Make your changes.
5. Run the checks CI runs, so the pull request does not find out for you:
   ```bash
   # Frontend
   cd crates/mumble-tauri/ui
   npm test
   npm run lint
   npx tsc --noEmit

   # Rust
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --package mumble-protocol --features opus-codec --lib
   ```
6. Commit and push your branch, then open a pull request.

## Development Workflow

```bash
# Start the dev server (hot-reloads Rust + JS)
cd crates/mumble-tauri
cargo tauri dev

# Frontend-only iteration (faster, no Rust rebuild)
cd crates/mumble-tauri/ui
npm run dev
```

## Pull Request Guidelines

- **Keep PRs focused** - one feature or fix per PR.
- **Write descriptive commits** - use conventional-style messages
  (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).
- **Add tests** when adding new functionality.
- **Follow existing style** - Rust uses Clippy, TypeScript uses strict mode.
  See the [copilot instructions](copilot-instructions.md) for
  conventions.
- **Boy Scout Rule** - leave files cleaner than you found them.  Fix lint
  warnings, unused imports, and small issues in files you touch.

## Reporting Bugs

Use the [Bug Report](https://github.com/Fancy-Mumble/FancyMumble/issues/new?template=bug_report.yml)
issue template. Include:

- Steps to reproduce
- Expected vs. actual behaviour
- OS and app version
- Logs or screenshots if applicable

## Suggesting Features

Use the [Feature Request](https://github.com/Fancy-Mumble/FancyMumble/issues/new?template=feature_request.yml)
issue template. Describe the use case and why it would be valuable.

## Project Structure

The [README](../README.md#architecture) lists the crates, and
[`ui/src/README.md`](../crates/mumble-tauri/ui/src/README.md) explains how the
frontend is split into a shared core and its UI packs. The
[copilot instructions](copilot-instructions.md) hold the coding conventions.

## License

By contributing you agree that your contributions will be licensed under the
[MIT License](../LICENSE).
