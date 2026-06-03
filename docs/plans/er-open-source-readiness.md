# Elite Redux — Open-Source Readiness & Secrets Audit

Audit performed before publishing the Elite Redux fork publicly (AGPL-3.0, inherited
from upstream PokeRogue). Goal: confirm no real secrets/credentials are committed,
and that the "Director" (LLM Story Mode) is not exposed in public production builds.

_Last reviewed: 2026-06-03._

## TL;DR

- **No real secrets are committed.** The only credential-looking values in the repo
  are public OAuth **client IDs** (Discord / Google), which are public by design.
- The **NanoGPT API key** (`VITE_NANOGPT_API_KEY`) used by the Director is **not**
  committed to any `.env*` file. It only exists as an env-var *name*.
- The Director / "Story Mode" menu entry is now **hidden in production** unless its
  env vars are configured (see #219 below).

## 1. Credentials & secrets scan

| Value | Where | Verdict |
|-------|-------|---------|
| `VITE_DISCORD_CLIENT_ID=1248062921129459756` | `.env`, `.env.beta`, `.env.production` | **Public, safe.** OAuth client IDs are embedded in every page that does OAuth and are not secrets. The Discord *client secret* is server-side only and is NOT in this repo. |
| `VITE_GOOGLE_CLIENT_ID=955345393540-…apps.googleusercontent.com` | `.env`, `.env.beta`, `.env.production` | **Public, safe.** Same reasoning — Google client IDs are public; the *client secret* lives only on the auth server. |
| `VITE_NANOGPT_API_KEY` | `src/vite.env.d.ts` (name only) | **Not committed.** No value exists in any `.env*` file. The Director silently disables itself when it is absent. Keep it out of committed env files; inject it only at build time in private/beta deploys. |
| `saveKey = "x0i2O7WRiANTqPmZ"` | `src/constants.ts` | **Not a secret.** Client-side AES obfuscation key for localStorage saves; identical in upstream PokeRogue and shipped in every client. It only obfuscates local save data; it protects nothing server-side. |
| `secretId` | `src/system/game-data.ts`, `src/@types/save-data.ts` | **Not a credential.** This is the in-game Pokémon "Secret ID" trainer mechanic, not an API secret. |
| `fake_token`, `test-key`, `secret-do-not-leak` | `test/**` | **Test fixtures only.** Used in tests (one asserts the Director never logs its key). |

**No** Firebase/Supabase configs, Bearer tokens, private keys, or `.pem`/service-account
files were found in source.

### External endpoints the client can call
- **`VITE_SERVER_URL`** — the PokeRogue account/save API (`api.pokerogue.net` in prod).
  A standalone/public deploy runs with `VITE_BYPASS_LOGIN=1` (Guest mode), in which case
  the client never calls this and stores saves in `localStorage` only.
- **`VITE_NANOGPT_BASE_URL`** — the Director's LLM endpoint. Only active when both NanoGPT
  env vars are set at build time; absent from all committed env files, so it never fires in
  a normal build.

## 2. Director / "Story Mode" gating (#219)

The LLM Director (`GameModes.LLM_DIRECTOR`) requires `VITE_NANOGPT_API_KEY` +
`VITE_NANOGPT_BASE_URL`. Previously the **New Game → mode** menu always listed it, so a
production player without the key could pick it and have it silently degrade to Classic.

**Change:** `src/phases/title-phase.ts` now shows the real Director entry only when
`isDev || isBeta || isDirectorConfigured()`. Otherwise it shows a non-selectable
**"Story Mode (Coming Soon)"** placeholder (plays the error SFX, keeps the menu open).
`isDirectorConfigured()` (added to `src/system/llm-director/director-runtime.ts`) is a
side-effect-free env check safe to call from the title menu.

To enable Story Mode in a private/beta deploy: build with both NanoGPT env vars set.

## 3. Pre-publish checklist

- [x] No real secrets committed (this audit).
- [x] Director hidden behind "Coming Soon" in public production builds.
- [ ] Confirm `LICENSE` (AGPL-3.0) is present and attribution to upstream PokeRogue /
      Pagefault Games is retained.
- [ ] Update `index.html` social/OG meta tags (currently point at `pokerogue.net`) to
      the public deployment URL.
- [ ] Rotate the Discord/Google OAuth client IDs to your own apps if you stand up your
      own auth server (optional; only relevant if not using Guest mode).
