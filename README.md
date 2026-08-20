# RF Transparent Tools

Internal operations software for RF Transparent. The application combines sales, pipeline, marketing, customer service, warehouse, purchasing, employee, accounting, task, and system-health workflows in one authenticated Next.js application.

## Requirements

- Node.js 20.9 or newer
- npm
- A Supabase project
- Credentials for the external services used in the target environment

## Local setup

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Create the local environment file:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in the required Supabase values. Add service-specific credentials only for the dashboards you need locally.

4. Start the application:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

## Quality commands

| Command | Purpose |
| --- | --- |
| `npm run lint` | Run ESLint, including the Next.js and React rules |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm test` | Run the Vitest unit suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build` | Create the production Next.js build |
| `npm run test:e2e` | Run Playwright browser smoke tests against a built app |
| `npm run test:e2e:mobile:public` | Run signed-out mobile login checks in four WebKit viewports |
| `npm run test:e2e:mobile` | Run the authenticated frontline mobile suite in four WebKit viewports |
| `npm run check` | Run lint, typecheck, and unit tests |
| `npm run ios:release-check` | Run every automated web and iOS release gate |
| `npm run ios:build:sim` | Build the Debug iOS app for the simulator |
| `npm run ios:build:sim:release` | Build the Release iOS app and enforce the production-server guard |

Playwright starts `npm run start`, so create a production build before running the browser suite locally:

```bash
npm run build
npm run test:e2e
```

The signed-out browser tests run without credentials. Authenticated tests require a Playwright storage-state file:

```bash
E2E_STORAGE_STATE=/absolute/path/to/auth.json npm run test:e2e
```

Use a non-production test account and never commit its storage-state file.

The full mobile suite requires a warehouse employee test session so every
authenticated workflow, including report identity binding, actually runs:

```bash
E2E_MOBILE_STORAGE_STATE=/absolute/path/to/warehouse-auth.json \
E2E_MOBILE_DEPARTMENT=warehouse \
npm run test:e2e:mobile
```

The full command fails its preflight when this state is missing or when the
department marker is not `warehouse`. This prevents skipped authenticated
tests from being reported as a successful release gate. Use
`npm run test:e2e:mobile:public` when only the signed-out checks are needed.

## iOS development and release checks

The Capacitor configuration defaults to `https://tools.rftransparent.ca`.
Use the explicit sync command that matches the intended build:

```bash
npm run cap:sync:dev
npm run cap:sync:prod
```

`cap:sync:dev` uses `http://127.0.0.1:3000` and permits cleartext traffic for
the local simulator only. `cap:sync:prod` forces the production HTTPS origin,
disables cleartext traffic, and validates the generated iOS configuration.

Before an internal TestFlight upload, provide the warehouse test storage state
and run:

```bash
E2E_MOBILE_STORAGE_STATE=/absolute/path/to/warehouse-auth.json \
E2E_MOBILE_DEPARTMENT=warehouse \
npm run ios:release-check
```

The real-device checks and staged rollout steps are in
[`docs/ios-testflight-rollout.md`](docs/ios-testflight-rollout.md).

## Architecture

- `src/app`: App Router pages, layouts, and route handlers
- `src/components`: Client dashboards and shared application UI
- `src/lib`: External integrations, authorization, domain services, and data-access helpers
- `src/hooks`: Reusable client hooks
- `supabase/migrations`: Database schema history
- `e2e`: Playwright smoke tests
- `docs`: Operational and domain documentation

Authentication uses Supabase. The proxy performs the initial session check, while pages, route handlers, and data-access functions repeat secure authorization checks close to protected data. Client-side role filtering is only a usability feature.

See [Permissions](docs/permissions.md) for the role model and [Database migrations](docs/database-migrations.md) for migration policy.

## External systems

The app can integrate with:

- Supabase
- Shopify
- Gmail
- Google Ads and Google Analytics
- Meta lead webhooks
- Resend
- Meta WhatsApp Cloud API
- The customer-service scraper
- Vercel Cron

Missing optional credentials should affect only the corresponding integration. The health-check and home dashboards surface unavailable sources.

## Deployment

Production is deployed through Vercel. `vercel.json` defines scheduled jobs. Configure all required environment variables in the deployment environment, then verify:

```bash
npm run check
npm run build
```

For Gmail, add this authorized redirect URI to the Google OAuth web client:

```text
https://tools.rftransparent.ca/api/oauth/gmail/callback
```

After deployment, administrators connect or reconnect each company inbox from the Email card on `/health-check`. The callback verifies the selected mailbox, saves the refresh token in protected server-only settings, and runs the first sync automatically.

After deployment, verify login, the home dashboard, automation health, and each enabled external data source.

## Security notes

- Never commit `.env.local`, credentials, exports containing customer data, or Playwright storage state.
- Treat route handlers and cron endpoints as public entry points.
- Keep authorization checks in server-side data paths even when the UI hides an action.
- Public survey links and lead webhooks use unguessable tokens or configured secrets.
- Review dependency audit results deliberately. Do not use force upgrades without checking breaking changes.
