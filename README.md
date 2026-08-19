# BasketStat Trends

A lightweight dashboard for coaches to upload game CSVs, track player stats over time, and surface quick trend insights.

## Pages
- **Dashboard:** `index.html`
- **Admin Upload:** `admin.html`

## CSV format
Each game CSV should include a `player` column plus any number of stat columns.
Example:

```csv
player,PTS,REB,AST
Jordan,28,6,4
Sam,12,10,2
```

In the Admin page, you will still provide the game date and opponent.

## Local usage
Open `index.html` in a browser, or run a static server:

```bash
npx serve .
```

## Deployment
The included GitHub Actions workflow publishes the site to GitHub Pages on every push to `main`.

## Authentication & access control

Access is account-based. Each user has an individual account with a role
(`user` or `admin`). Accounts live in an encrypted user store (Vercel Blob in
production, `data/users.json` locally — both AES-256-GCM encrypted at rest).
Passwords are hashed with Argon2id and are never stored or logged in plaintext.

### First-run bootstrap
The store starts empty. Set `ADMIN_PASSWORD` (and optionally `APP_PASSWORD`) in
your environment, then sign in on `/login.html` with any email and that password.
The first successful login **creates** the corresponding account (admin for
`ADMIN_PASSWORD`, user for `APP_PASSWORD`). After that, the env passwords are
ignored and all logins go through the user store.

### Managing users (admins)
On the Settings page (`admin.html`) → **User Access** you can:
- **Add a user** — generates a one-time password shown once; share it securely.
- **Regenerate a password** — invalidates the old one immediately.
- **Change role** (user ↔ admin) and **enable/disable** accounts. Disabling or
  demoting takes effect on the user's next request. The last active admin is
  protected from being removed.
- **Unlink** a social sign-in from an account.

Users can change their own password at `/change-password.html`.

### Social sign-in (Google, Apple, Vipps)
OAuth/OIDC is **invite-only**: a provider login only succeeds if the returned
email already matches an existing account (it then links that identity), or an
identity was previously linked. Unknown emails are rejected.

Configure any subset of providers via environment variables (see
`.env.example`). Buttons appear on the login page only for fully configured
providers. Register each provider callback URL:

```
{BASE_URL}/api/auth/oauth/google/callback
{BASE_URL}/api/auth/oauth/apple/callback
{BASE_URL}/api/auth/oauth/vipps/callback
```

- **Google** — create an OAuth client ID at
  [Google Cloud Console](https://console.cloud.google.com/apis/credentials);
  set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- **Apple** — create a Services ID + key at
  [developer.apple.com](https://developer.apple.com); set `APPLE_SERVICES_ID`,
  `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and the `.p8` contents in `APPLE_PRIVATE_KEY`.
- **Vipps** — configure Login for your sales unit in the
  [Vipps MobilePay portal](https://portal.vippsmobilepay.com), whitelist the
  callback URL, and set `VIPPS_CLIENT_ID` / `VIPPS_CLIENT_SECRET`
  (`VIPPS_TEST=1` for the test environment).

### Security notes
- Session is a signed (HMAC-SHA256) cookie carrying the user id; the server
  re-checks the account on every request so revocation is immediate.
- The user store is encrypted at rest with a key derived from `USERS_SECRET`
  (falls back to `SESSION_SECRET`). Set it once and keep it stable.
- Login is rate-limited; OAuth uses state + nonce + PKCE; admin mutations require
  a same-origin request.
