# Deploying the Zaina Platform on Railway

The platform runs as its own Railway service with its own Postgres database,
in the same Railway project as the TBM website. Nothing here changes the TBM
service: it keeps deploying from `main` with its own database and its own
Zaina.

```
Railway project
├── TBM service      (main branch, root railway.json)        ← unchanged
├── TBM Postgres                                               ← unchanged
├── zaina            (platform service, zaina-platform/railway.json)
└── zaina-db         (the platform's Postgres)
```

## 1. Create the database

1. In Railway, open the project where the TBM website runs.
2. Click **+ Create** (top right of the canvas) → **Database** → **PostgreSQL**.
   Railway deploys a Postgres service with its own volume.
3. Open the new service → **Settings** → rename it **`zaina-db`**. The
   platform's variables below refer to it by this name.
4. Open **Backups** on `zaina-db` and turn on a daily schedule (paid plans).

That's all for the database. The platform creates its tables, its restricted
`zaina_app` role and TBM's starting settings itself, at its first release.

## 2. Create the platform service

1. **+ Create** → **Empty Service**. Rename it **`zaina`** (Settings).
2. **Settings → Source**: connect the repository
   `jameskaminah3-commits/TBM`, branch **`claude/clever-gates-6vv6rw`**
   (until the platform is merged into `main`). Leave the root directory empty.
3. **Settings → Config-as-code → Railway config file**:
   `/zaina-platform/railway.json`. It sets the build, the release step
   (`npm run release`: migrations, the `zaina_app` password, the first admin,
   TBM's knowledge), the start command and the health check (`/v1/health`).
4. **Settings → Networking → Generate Domain** (or add your own, for example
   `zaina.tembeabilamatata.com` with a CNAME record).
5. **Variables** (Raw Editor), with your own values in place of `<…>`:

   ```
   PLATFORM_DATABASE_URL=${{zaina-db.DATABASE_URL}}
   ZAINA_APP_DB_PASSWORD=<letters and digits only, 32 or more>
   PLATFORM_APP_DATABASE_URL=postgresql://zaina_app:${{ZAINA_APP_DB_PASSWORD}}@${{zaina-db.PGHOST}}:${{zaina-db.PGPORT}}/${{zaina-db.PGDATABASE}}
   SESSION_TOKEN_SECRET=<random, 48 characters or more>
   PLATFORM_SECRETS_KEY=<output of: openssl rand -base64 32>
   GEMINI_API_KEY=<the model key, or ${{<TBM service name>.GEMINI_API_KEY}}>
   PUBLIC_BASE_URL=https://<the domain from step 4>
   PLATFORM_ADMIN_EMAIL=<your email>
   PLATFORM_ADMIN_PASSWORD=<a starting password: 10+ characters, letters and digits>
   ```

   - Type `${{` in the editor to pick `zaina-db` and its variables from a list.
   - Generate the random values with a password manager, or `openssl rand -hex 32`
     (`PLATFORM_SECRETS_KEY` must be `openssl rand -base64 32`: exactly 32 bytes).
   - Keep `PLATFORM_SECRETS_KEY` safe: the businesses' encrypted secrets
     (WhatsApp tokens, payment keys) can't be read without it.
   - Leave **`TBM_DATABASE_URL` unset** for now. The platform then refuses
     TBM's chats and never touches TBM's live data; TBM's website keeps using
     the live Zaina. Setting it is part of moving TBM over, a separate step.
6. **Deploy**. The release step's log shows the migrations, the `zaina_app`
   role, the admin account and TBM's knowledge. The deploy is healthy when
   `https://<domain>/v1/health` answers.
7. Sign in to the console at `https://<domain>/console/` with
   `PLATFORM_ADMIN_EMAIL`, change the password (menu → Change password), then
   delete the `PLATFORM_ADMIN_PASSWORD` variable.

Every push to the branch that touches `zaina-platform/`, `server/`, `shared/`
or the root package files redeploys the platform. The TBM service only
follows `main`.

## 3. Alerts to staff (optional)

- **Phones and browsers (web push):** generate keys once with
  `npx web-push generate-vapid-keys`, then set `WEB_PUSH_PUBLIC_KEY`,
  `WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT=mailto:<your email>`. Staff turn
  alerts on in the console (on a phone: add the console to the home screen
  first; iPhones need iOS 16.4 or later).
- **Email:** `RESEND_API_KEY` and `ALERT_FROM_EMAIL` (an address on a domain
  verified in Resend). The TBM service's Resend key can be referenced.

## 4. WhatsApp (for a pilot business)

What Meta needs, once, for the platform:

1. A Meta developer app (developers.facebook.com → My Apps → Create app →
   type **Business**) with the **WhatsApp** product added.
2. **App settings → Basic → App secret**: set it as `WHATSAPP_APP_SECRET`.
   Choose a random `WHATSAPP_VERIFY_TOKEN` (16+ characters) and set it too.
   Redeploy.
3. **WhatsApp → Configuration → Webhook**: callback URL
   `https://<domain>/v1/whatsapp/webhook`, verify token = your
   `WHATSAPP_VERIFY_TOKEN`. Verify, then subscribe to the **messages** field.

For each business's number:

4. In **WhatsApp Manager**, add and verify the business's number, and note its
   **Phone number ID** and **WhatsApp Business Account ID**.
5. In **Business Settings → System users**, create a system user with access
   to the WhatsApp account, and generate a **permanent token** with
   `whatsapp_business_messaging` and `whatsapp_business_management`.
6. Optional: in WhatsApp Manager, create a **utility** message template for
   replies after 24 hours (for example: "Hello, the {{1}} team has replied to
   your message. Reply here to continue.") and wait for approval.
7. In the console: **Settings → WhatsApp** → phone number ID, account ID and
   the token (and the template's name and language). The platform checks the
   token with Meta before saving it, encrypted.

A number connected to the Cloud API can't be used in the WhatsApp Business
phone app at the same time; the team answers in the console instead.

## Checks after a deploy

- `https://<domain>/v1/health` → `{"ok":true,…}`
- The console signs in, and **Settings → Website widget** shows the embed code.
- With WhatsApp set up: a message to the business's number gets Zaina's reply,
  and appears in the console's inbox under **All**.
