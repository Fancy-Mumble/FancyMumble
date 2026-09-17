# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public
issue. Instead, report it privately through a GitHub Security Advisory:

<https://github.com/Fancy-Mumble/FancyMumble/security/advisories/new>

We will acknowledge receipt within **48 hours** and aim to provide a fix or
mitigation within **7 days** for critical issues.

## Scope

This policy covers everything in this repository: the desktop and Android
application, the protocol library (`mumble-protocol`) including end-to-end
encrypted persistent chat and its key handling, the `signal-bridge` library,
and the minimal Qt client (`qt6ui`). It does **not** cover the Mumble server
software.

## What Qualifies

- Remote code execution
- TLS/certificate validation bypasses
- XSS or injection in the chat/profile rendering pipeline
- Authentication or authorisation bypasses
- Information disclosure (e.g. credential leaks, key material exposure)

## What Does Not Qualify

- Denial of service against a user's own machine
- Issues in third-party dependencies (report those upstream, but let us
  know so we can update)
- Social engineering

## Disclosure

We follow coordinated disclosure. Once a fix is released we will credit
the reporter (unless they prefer anonymity) in the release notes.
