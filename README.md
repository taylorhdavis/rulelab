# RuleLab

An open-source workspace for writing, validating, and locally testing Google SecOps YARA-L 2.0 detection rules.

RuleLab includes a Monaco editor, compiler diagnostics, formatter, rule inspector, saved rules and version history, UDM-style test cases, data tables, a local evaluator, and an authenticated HTTP API. All accounts have the same authoring features; administrators manage users and instance settings.

Local evaluation is an authoring aid and can differ from Google SecOps. Validate production behaviour in your Google SecOps environment. RuleLab is independent of Google and does not automatically submit rules or events to Google SecOps.

## Requirements

- Node.js 24 LTS (24.14.1 or newer) and npm
- Wasp 0.24.0, matching `main.wasp.ts`
- PostgreSQL (Docker can provide the local database)

Install the matching Wasp CLI (see the [Wasp 0.24 installation guide](https://wasp.sh/docs/0.24/quick-start)):

```sh
npm install -g @wasp.sh/wasp-cli@0.24.0
```

Windows users should run these commands inside WSL, with the project stored in the Linux filesystem. Docker must be available there.

## Run the app

Extract or clone the source, open a terminal in the folder containing `main.wasp.ts`, and create your private configuration:

```sh
cp .env.server.example .env.server
```

Set the default administrator password in `.env.server`, or set `RULELAB_DEFAULT_ADMIN_ENABLED=false` to skip administrator provisioning. The initial admin password must contain 12–128 characters including a number.

Generate an API-key hashing secret and copy the output into `API_KEY_HASH_SECRET` in `.env.server`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep this secret stable; changing it invalidates existing API keys. Use a unique admin password, rather than the illustrative value below.

Install the project dependencies first (a fresh checkout needs this before starting the database):

```sh
wasp install
```

With Docker running and port 5432 free, start PostgreSQL in one terminal:

```sh
wasp start db
```

In another terminal, apply database migrations and start the app. Wasp generates its SDK and installs the application dependencies. Installation also bundles the isolated local-evaluation worker automatically. Keep both processes running.

```sh
wasp db migrate-dev
wasp start
```

Open <http://localhost:3000>. The root page is the login screen, with a signup link. Signup signs you in immediately without email verification. Rules, versions, test cases, and data tables are stored in PostgreSQL under your account.

## Default administrator

Configure the initial administrator before the first start:

```dotenv
RULELAB_DEFAULT_ADMIN_ENABLED=true
RULELAB_DEFAULT_ADMIN_EMAIL=admin@example.com
RULELAB_DEFAULT_ADMIN_PASSWORD=choose_your_own_password_123
```

The account is provisioned once in development or production. Existing administrators are adopted without resetting their passwords. You can change the password in Profile → Security and remove the bootstrap password from the environment after setup.

To remove the default administrator, create a replacement in Admin → Users and use that account to delete it. Self-deletion is also available in Profile → Security. A completion marker survives account deletion, so restarting does not recreate the default account. Signup does not grant administrator privileges.

## API and email

Enable API access in the admin settings, set `API_KEY_HASH_SECRET` as described above, and create a key in Profile → API. See `/api-docs` in the app, the [OpenAPI definition](public/api-docs/openapi.json), and the [request examples](public/api-docs/examples.json).

Account limits are 1,000 saved rules, 500 test cases, 100 data tables, 1,000 events per test case, and 10 active API keys. Request-size limits, rate limits, and evaluation timeouts also apply.

Mailgun is used for password-reset delivery. Configure its credentials and the sender addresses in `main.wasp.ts` and `src/server/passwordReset.ts` if you need that feature. Signup and login send no email. Wasp requires the email configuration values at startup; the example placeholders can be used locally when email delivery is not needed.

## Build and deploy

```sh
npm run typecheck
npm run audit:prod
wasp build
```

For hosting, follow the [Wasp 0.24 deployment guide](https://wasp.sh/docs/0.24/deployment/intro); the frontend, server, and PostgreSQL database are deployed separately. `wasp build` generates the deployable project, while the chosen deployment method performs the final frontend/server builds. Configure your client/server origins, PostgreSQL connection, JWT secret, default-admin credentials, and API-key hashing secret through the hosting environment. Keep real `.env` files and database backups private. The migration directory contains a clean initial schema for fresh installations. Existing installations that used the former migration history must baseline their database before upgrading; do not reset a database containing data you want to retain.

If your frontend host applies a Content Security Policy, allow Monaco's blob workers. For a generated Caddy configuration, `npm run patch:client-csp` adds the worker directive after the Caddyfile is generated.

## License

RuleLab is licensed under [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution. Third-party names and trademarks belong to their respective owners.
