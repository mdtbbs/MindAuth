### Task 1: Freeze the external contract with tests

**Files:**
- Modify: `tests/specs/oauth/oauth-flow.spec.js`
- Create: `tests/specs/oauth/oauth-contract.spec.js`
- Create: `tests/specs/security/security-contract.spec.js`
- Create: `tests/specs/auth/session-contract.spec.js`
- Modify: `playwright.config.js`

**Interfaces:**
- Consumes current app behavior.
- Produces a contract suite that all later tasks must keep passing unless an intentional behavior change is documented.

- [ ] Add tests for OIDC discovery paths and require endpoints to include `/api/*` after the refactor.
- [ ] Add tests for `/api/token`, `/api/refresh`, `/api/revoke`, `/api/introspect`, `/api/userinfo`, `/api/user`, and `/api/verify` response shapes.
- [ ] Add tests for CSRF: browser state-changing routes require token; `/api/token`, `/api/refresh`, `/api/revoke`, `/api/verify` remain exempt.
- [ ] Add tests for session semantics: multi-device login, current-session logout, revoke-all on password change/reset.
- [ ] Add tests for redirect URI rejection in admin client creation/update.
- [ ] Add tests for exact and CIDR IP bans.
- [ ] Run `npx playwright test` and record any current failures that are known bugs to fix during refactor.
- [ ] Commit: `test: freeze MindAuth auth and OAuth contracts`.

