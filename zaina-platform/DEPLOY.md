# Deploying the Zaina Platform

The platform's database is its own **Supabase** project. The service runs on
**Railway**, next to the TBM website. Nothing here changes TBM: the website
keeps deploying from `main`, with its own Supabase database and its own
Zaina.

```
Supabase (your organization)
├── TBM's project        TBM's database                       ← unchanged
└── zaina-platform       the platform's database              ← new

Railway (the project where the TBM website runs)
├── TBM service          main branch, root railway.json       ← unchanged
└── zaina                the platform, zaina-platform/railway.json
```

**Why a separate Supabase project, not TBM's.** Every TBM deploy runs
`drizzle-kit push`, which reshapes TBM's `public` schema to match TBM's code.
The platform's tables would be strangers there. A separate project also keeps
backups, connection limits and access apart. When TBM moves onto the
platform, the platform reaches TBM's database through `TBM_DATABASE_URL`.
The two databases stay separate.

## 1. Create the database (Supabase)

1. In the Supabase dashboard, open the organization that holds TBM's project
   and click **New project**:
   - **Name:** `zaina-platform`.
   - **Database password:** click **Generate a password** and save it in your
     password manager. It only goes into Railway's variables (step 2).
   - **Region:** the same as TBM's project, which is near the Railway
     services.
   - **Plan:** a live service needs the Pro plan. Free projects pause after a
     week without use and have no backups.
2. When the project is ready, click **Connect** at the top of the dashboard
   and copy the **Session pooler** connection string. It looks like:

   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

   Use the session pooler. The direct connection (`db.<project-ref>.supabase.co`)
   is IPv6-only, and the platform refuses the transaction pooler (port 6543):
   it keeps settings and locks for a whole connection, and that pooler drops
   them between transactions.
3. **Project Settings → Database → SSL Configuration:**
   - Click **Download certificate**, then open the file in a text editor.
     Its text goes into Railway in step 2, so the platform can check it's
     really talking to your database.
   - Turn on **Enforce SSL on incoming connections**.
4. **Project Settings → Data API:** turn the Data API off. The platform
   doesn't use it. Its roles (`anon`, `authenticated`, `service_role`) are
   also taken off every platform table by migration 0006, even if the API is
   left on.

That's all for the database. At its first release, the platform creates its
own tables, its restricted `zaina_app` role and TBM's starting settings.

## 2. Create the platform service (Railway)

1. In the Railway project where the TBM website runs: **+ Create** → **Empty
   Service**. Rename it **`zaina`** (Settings).
2. **Settings → Source**: connect the repository `jameskaminah3-commits/TBM`,
   branch **`claude/clever-gates-6vv6rw`** (until the platform is merged into
   `main`). Leave the root directory empty.
3. **Settings → Config-as-code → Railway config file**:
   `/zaina-platform/railway.json`. It sets:
   - the build;
   - the release step (`npm run release`: migrations, the `zaina_app`
     password, the first admin, TBM's knowledge);
   - the start command;
   - the health check (`/v1/health`).
4. **Settings → Networking → Generate Domain**, or add your own domain (for
   example `zaina.tembeabilamatata.com`, with a CNAME record).
5. **Variables** (Raw Editor). Put your own values in place of `<…>`:

   ```
   PLATFORM_DATABASE_URL=postgresql://postgres.<project-ref>:<database password>@<pooler host>:5432/postgres?sslmode=require
   ZAINA_APP_DB_PASSWORD=<letters and digits only, 32 or more>
   PLATFORM_APP_DATABASE_URL=postgresql://zaina_app.<project-ref>:${{ZAINA_APP_DB_PASSWORD}}@<pooler host>:5432/postgres?sslmode=require
   PLATFORM_DB_POOL_MAX=6
   SESSION_TOKEN_SECRET=<random, 48 characters or more>
   PLATFORM_SECRETS_KEY=<output of: openssl rand -base64 32>
   GEMINI_API_KEY=<the model key, or ${{<TBM service name>.GEMINI_API_KEY}}>
   PUBLIC_BASE_URL=https://<the domain from step 4>
   PLATFORM_ADMIN_EMAIL=<your email>
   PLATFORM_ADMIN_PASSWORD=<a starting password: 10+ characters, letters and digits>
   ```

   Then add **`PLATFORM_DATABASE_CA`** as its own variable (**+ New
   Variable**, not the Raw Editor), and paste the certificate file's whole
   text as its value, from `-----BEGIN CERTIFICATE-----` to
   `-----END CERTIFICATE-----`. The platform also accepts it on one line.

   About these variables:
   - **Addresses.** `<project-ref>` and `<pooler host>` are the ones in the
     session pooler string from step 1. Both addresses use the same host.
     Only the user changes: `postgres.<project-ref>` for the owner (migrations
     and the platform's own work), and `zaina_app.<project-ref>` for business
     queries, which row-level security keeps to one business at a time.
   - **The database password** goes in place of `[YOUR-PASSWORD]`. If it has
     symbols, percent-encode them (for example, `@` becomes `%40`).
   - **`zaina_app`'s password.** You choose `ZAINA_APP_DB_PASSWORD`. At every
     release, the release step checks that `zaina_app` can sign in with it,
     sets it if not, and waits until Supabase's pooler lets it in.
   - **`PLATFORM_DB_POOL_MAX`** caps the connections business queries hold.
     Keep it well under the session pooler's **Pool Size** (Project Settings →
     Database → Connection pooling), so a new version can start while the old
     one still runs.
   - **Random values.** Generate them with a password manager, or with
     `openssl rand -hex 32`. `PLATFORM_SECRETS_KEY` must come from
     `openssl rand -base64 32`: exactly 32 bytes.
   - **Keep `PLATFORM_SECRETS_KEY` safe.** The businesses' encrypted secrets
     (WhatsApp tokens, payment keys) can't be read without it, even from a
     backup.
   - **Leave `TBM_DATABASE_URL` unset** for now. The platform then refuses
     TBM's chats and never touches TBM's live data, and TBM's website keeps
     using the live Zaina. Setting it is part of moving TBM over, which is a
     separate step.
6. **Deploy.** The release step's log shows:
   - the database line (`TLS on, the server is checked against Supabase Root
     2021 CA`, or whatever CA name your certificate has);
   - the migrations;
   - `zaina_app can sign in`;
   - the admin account;
   - TBM's knowledge.

   The deploy is healthy when `https://<domain>/v1/health` answers.
7. Sign in to the console at `https://<domain>/console/` with
   `PLATFORM_ADMIN_EMAIL`. Change the password (menu → Change password), then
   delete the `PLATFORM_ADMIN_PASSWORD` variable.

Every push to the branch that touches `zaina-platform/`, `server/`, `shared/`
or the root package files redeploys the platform. The TBM service only
follows `main`.

**If the release step fails,** the running version keeps serving. The log
says what to check:

| Message | What to check |
|---|---|
| `transaction pooler (port 6543)` | Use the session pooler address (port 5432) |
| `the user name ends with the project` | On the pooler the user is `postgres.<project-ref>` or `zaina_app.<project-ref>` |
| `Tenant or user not found` | The user name and the pooler host's region |
| `password authentication failed` | The database password in `PLATFORM_DATABASE_URL` |
| `certificate wasn't accepted` | `PLATFORM_DATABASE_CA` is this project's certificate |
| `didn't answer in time` | The project isn't paused (Supabase dashboard) |
| `same database` | Both addresses have the same host, port, database and project |

## 3. Alerts to staff (optional)

- **Phones and browsers (web push):**
  1. Generate keys once with `npx web-push generate-vapid-keys`.
  2. Set `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` and
     `WEB_PUSH_SUBJECT=mailto:<your email>`.
  3. Staff turn alerts on in the console. On a phone, they add the console
     to the home screen first. iPhones need iOS 16.4 or later.
- **Email:** set `RESEND_API_KEY` and `ALERT_FROM_EMAIL` (an address on a
  domain verified in Resend). You can reference the TBM service's Resend key.

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

4. In **WhatsApp Manager**, add and verify the business's number. Note its
   **Phone number ID** and **WhatsApp Business Account ID**.
5. In **Business Settings → System users**, create a system user with access
   to the WhatsApp account, and generate a **permanent token** with
   `whatsapp_business_messaging` and `whatsapp_business_management`.
6. Optional: in WhatsApp Manager, create a **utility** message template for
   replies after 24 hours, and wait for approval. For example: "Hello, the
   {{1}} team has replied to your message. Reply here to continue."
7. In the console: **Settings → WhatsApp**. Enter the phone number ID, the
   account ID and the token, plus the template's name and language if you
   made one. The platform checks the token with Meta before saving it,
   encrypted.

A number connected to the Cloud API can't be used in the WhatsApp Business
phone app at the same time. The team answers in the console instead.

## 5. A place to stay: rooms and deposits

A business added as a place to stay (type `guesthouse`) gets **Bookings** and
**Rooms** in the console. Its owner sets them up there:

1. **Rooms.** Add each room type, or import a spreadsheet, with its prices.
2. **Settings → Bookings & payments → Booking policy.** Set the deposit, how
   long unpaid rooms are held, check-in and check-out times, tax and the
   cancellation policy.
3. **Where deposits are paid.** Connect one or more of:
   - **Paystack, with the business's own account.**
     1. In the Paystack dashboard, go to Settings → API Keys & Webhooks.
     2. Copy the **secret key** (`sk_live_…`) into the console.
     3. In the same Paystack page, set the **Webhook URL** to the address the
        console shows: `https://<domain>/v1/payments/paystack/<business id>`.
   - **Paystack, as a subaccount of the platform's account.** Only if the
     platform has a Paystack account of its own:
     1. Set `PLATFORM_PAYSTACK_SECRET_KEY` on the platform service.
     2. Set that account's webhook URL to
        `https://<domain>/v1/payments/paystack`.
     3. Create the business's subaccount in Paystack (Subaccounts).
     4. Enter the subaccount's code (`ACCT_…`) in the console.
   - **M-Pesa Express, on the business's own paybill or till.**
     1. On Safaricom's Daraja portal (developer.safaricom.co.ke), the business
        creates an app with M-Pesa Express (Lipa na M-Pesa Online).
     2. It takes the app live for its shortcode (Go Live). Safaricom then
        gives the passkey.
     3. In the console, enter the consumer key, consumer secret and passkey,
        with the paybill number, or the store number and till number.

     Safaricom calls back at `https://<domain>/v1/payments/mpesa/…`, so
     `PUBLIC_BASE_URL` must be the service's public https address.
   - **M-Pesa paid by hand.** Enter the paybill number (and account) or the
     till number. The guest sends the M-Pesa code. The team checks it in the
     M-Pesa statement and confirms it in the console (Bookings → Needs you).
4. **Try it:** make a booking in the chat, open its payment page, and make a
   small payment. Paystack's `sk_test_` keys and Daraja's sandbox work too
   (choose Sandbox in the console).

Deposits go straight to the business's account. Refunds are made there
(Paystack's dashboard, or M-Pesa), not from the console.

## Backups

On the Pro plan, Supabase keeps daily backups (Database → Backups);
point-in-time recovery is an add-on. A restored database needs the same
`PLATFORM_SECRETS_KEY` to read the businesses' secrets.

## Checks after a deploy

- `https://<domain>/v1/health` answers `{"ok":true,…}`.
- The console signs in, and **Settings → Website widget** shows the embed
  code.
- With WhatsApp set up: a message to the business's number gets Zaina's
  reply, and appears in the console's inbox under **All**.
- For a place to stay: a test booking in the chat gets a payment link, and
  its page shows the booking and the ways to pay.
