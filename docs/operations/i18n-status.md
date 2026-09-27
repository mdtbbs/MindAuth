# Interface translation coverage

The public MindAuth sign-in, registration, account, developer, notification, device authorization, and OAuth client management page support English, Russian, Japanese, and Simplified Chinese. The OAuth client management page has its own locale selector because the administration frontend is a separate React application from the account center.

## Remaining untranslated surfaces

- Admin shell and admin login.
- Admin dashboard, user/session/risk management, email policy, application review, general settings, and audit/log pages.
- Some dynamic backend validation and database-derived values that are still prose or user-entered data.

These are mostly operator-only administration pages. Stable API codes and OAuth ecosystem identifiers remain unchanged for integrations.
