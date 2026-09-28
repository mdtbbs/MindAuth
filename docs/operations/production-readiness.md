# Mindustry Club production readiness

Run `NODE_ENV=production npm run readiness:production` with the intended MindAuth production environment loaded and after building the frontend. This check uses only `SELECT` queries against MySQL and inspects configuration/build output; it does not apply migrations, create or change OAuth clients, or modify production data.

It checks:

- Migration 018 is recorded in `schema_version`.
- GitHub and Discord are either explicitly disabled or have client ID/secret and an HTTPS callback on the expected MindAuth route and origin. Compare each callback with the exact URI registered in the provider console.
- Provider secrets are not copied into `NEXT_PUBLIC_*` variables or the built frontend bundle. Secrets are never printed.
- The configured Mindustry Club OAuth client exists as a confidential, approved, first-party client with `ecosystem=mindustry-club`.
- The database Redirect URI allowlist exactly matches `CLUB_OAUTH_REDIRECT_URIS` and every production URI uses HTTPS.
- UI locale resolution falls back through supported account/request preferences to English; email and notification fallback resolve account locale and then the documented supported-language default.

Set `CLUB_OAUTH_CLIENT_ID` and a comma-separated `CLUB_OAUTH_REDIRECT_URIS` for the Club client. A successful result still requires an operator to compare callback URLs with GitHub/Discord consoles and complete real browser OAuth flows.

## Remaining untranslated surfaces

The MindAuth sign-in, registration, account, developer, notification, device authorization, and OAuth client management surfaces expose English, Russian, Japanese, and Simplified Chinese. The separate admin shell and most operational admin pages remain primarily Simplified Chinese: dashboard, user/session/risk management, email policy, application review, general settings, and audit/log views. Dynamic backend validation prose may also remain Simplified Chinese; clients should prefer stable codes when available.
