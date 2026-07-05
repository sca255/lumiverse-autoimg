# Copilot Instructions for `lumiverse-autoimg`

## Build, test, and lint commands

No build, test, or lint commands are currently defined in this repository.

- Do not assume a language/toolchain or invent commands.
- If you add a toolchain, document the exact commands here, including a single-test invocation for that test runner.

## High-level architecture

Current repository state is a bootstrap skeleton:

- `README.md` defines project intent: automatic AI image generation on demand.
- There is no application source tree, runtime entry point, or package/build manifest yet.

Treat architecture work as greenfield until implementation files are added.

## Key conventions in this repository

- Prefer minimal, direct documentation updates aligned with `README.md` project intent.
- Keep decisions explicit in-repo (commit actual config/manifests) before referring to them as established conventions.
- When introducing tooling (build, lint, test, CI), update this file in the same change so future Copilot sessions have authoritative commands and patterns.
