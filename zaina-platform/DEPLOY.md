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
2. **Settings → Bookings & payments.** Choose the deposit (none, a
   percentage, a fixed amount or the whole price). Until it's chosen, nothing
   is charged online and chat bookings come in as requests. Set check-in and
   check-out times, tax and the cancellation policy, then, under **Ways to
   pay** and **Holds and limits**, the order payments are offered in, any
   limit per way to pay, and how long bookings are held.
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

## 6. A salon or restaurant: time slots

A business added as a salon (`salon`) or restaurant (`restaurant`) gets
**Bookings** and **Services** (or **Tables**) in the console. Its owner sets
up, in order:

1. **Services → Opening hours.** Each day's hours (a closing time before the
   opening one runs past midnight), and how often a booking can start.
2. **People and chairs** (or **Tables**, with their seats). Someone who works
   different hours gets their own.
3. **Services** (or **Table bookings**): length, the time after each booking
   before the next, party sizes, price, and who can do it.
4. **Settings → Bookings & payments**, as for a place to stay: the deposit
   (the business's choice, none by default), ways to pay and limits.

## 7. Calendars (optional)

Every business that takes bookings has **Settings → Calendars**:

- **Calendar links** work with no setup: a private iCal link to the
  bookings, for Google Calendar, Apple Calendar or Outlook.
- **iCal links** from Airbnb, Booking.com or a channel manager work with no
  setup either: their bookings close the room type's nights (or a person's
  or table's time). They're read every 10 minutes
  (`CALENDAR_SYNC_INTERVAL_MS`). Only public `https://` (or `webcal://`)
  addresses are fetched.
- **Google Calendar** needs the platform's own Google sign-in, once:
  1. In the [Google Cloud console](https://console.cloud.google.com/),
     create a project (or use one) and enable the **Google Calendar API**
     (APIs & Services → Library).
  2. **OAuth consent screen**: External; the app's name (Zaina), a support
     email, and the scopes `openid`, `email`,
     `https://www.googleapis.com/auth/calendar.readonly` and
     `https://www.googleapis.com/auth/calendar.events`. While the app is in
     *Testing*, add each owner's Google address as a test user; before
     many businesses use it, submit it for Google's verification (the
     calendar scopes are sensitive).
  3. **Credentials → Create credentials → OAuth client ID**: Web
     application, with the authorised redirect URI
     `https://<domain>/v1/calendar/google/callback` (the service's
     `PUBLIC_BASE_URL`).
  4. On the platform service in Railway, set `PLATFORM_GOOGLE_CLIENT_ID`
     (it ends in `.apps.googleusercontent.com`) and
     `PLATFORM_GOOGLE_CLIENT_SECRET`, both in Railway's Variables, never in
     a chat or the code.

  An owner then connects under Settings → Calendars. The refresh token Google
  returns is kept encrypted as the business's secret; disconnecting revokes
  it at Google.

## 8. Businesses signing up by themselves (optional)

Sign-up is closed until you open it. Before opening it:

1. Publish your **terms of service** and **privacy policy** as web pages.
   Set their addresses (https) as `PLATFORM_TERMS_URL` and
   `PLATFORM_PRIVACY_URL`; the sign-up form links to both, and a business
   must accept the terms to sign up.
2. Make sure email works (section 3: `RESEND_API_KEY` and `ALERT_FROM_EMAIL`)
   and `PUBLIC_BASE_URL` is set: every new owner confirms their email by a
   link before signing in.
3. Set `PLATFORM_SIGNUP=open` and redeploy. The service refuses to start if
   email or `PUBLIC_BASE_URL` is missing.

The console's sign-in page then offers **Sign up your business**. A new
business starts **setting up**: its owner signs in, works through **Set up**
(what Zaina says about the business, its knowledge, its rooms or services,
its deposit and a way to take it, where customers chat, a test chat with
Zaina, and a plan once you offer plans), then puts it live. Nobody from the
platform team is needed.

The platform page lists every business, where it came from, and when it
went live. **Pausing** one stops its website chat and WhatsApp until you
resume it; its team keeps the console. Sign-ups are limited per visitor
(5 an hour), per email (3 a day) and in all (500 a day). Set
`PLATFORM_SIGNUP=closed` (or remove it) to close sign-up again; businesses
already signed up carry on.

## 9. Billing (optional)

Billing is off until you offer a plan: businesses go live without choosing
one. Prices are yours to decide: none is built in.

1. **How businesses pay.** Either or both:
   - **Card or M-Pesa, through the platform's own Paystack account.** Set
     `PLATFORM_PAYSTACK_SECRET_KEY` (the account's `sk_live_…` key; the same
     one subaccounts use, section 5). In Paystack (Settings → API Keys &
     Webhooks), set the **Webhook URL** to
     `https://<domain>/v1/payments/paystack`. Invoices are told apart from
     bookings by their references (`zi_…`), so one webhook serves both.
   - **By hand**, to a bank account or an M-Pesa paybill or till of the
     platform's. Set `BILLING_PAYMENT_INSTRUCTIONS` to what the owner should
     do (up to 500 characters), for example "M-Pesa paybill 123456, account
     ZAINA." It's shown with every invoice and in the invoice emails, with
     the invoice's number as the reference. When the money arrives, **mark
     the invoice paid** on the platform page, with the M-Pesa code or bank
     reference.
2. **Plans.** On the platform page, under **Billing → Add a plan**: a name,
   what it's for, a price a month or a year, in shillings or dollars, a free
   trial (0 to 90 days; one trial per business), and how many conversations
   a month it's meant for (shown to the business, not enforced). Offer
   several; hide one to stop offering it (businesses on it keep it). A new
   price applies from each business's next invoice.
3. **Grace period.** `BILLING_GRACE_DAYS` (7 by default, 0 to 60): how long a
   live business keeps answering customers after an invoice is due. After
   that it pauses until the invoice is paid, then resumes at once. Days it
   was paused aren't charged: its paid period starts when it pays.

What happens then, with no one from the platform team:

- A business that signed up by itself chooses a plan in **Settings → Plan &
  billing** before going live: a free trial starts at once, or its first
  invoice is due at once.
- Each next period's invoice goes out a week before the period starts
  (halfway through a short trial), by email to the business's owners, with
  how to pay. A receipt follows each payment.
- Owners can change plan (from their next invoice) or cancel (at the end of
  what they've paid for).

On the platform page you **mark paid** an invoice paid by hand, **waive**
one (the business gets that period free), or **void** one (it isn't owed; a
plan still running gets a new invoice at its current price). **Payments to
look at** lists money Paystack reported for a different amount, or for an
invoice already paid (two tabs): refund those in Paystack's dashboard.

Businesses the platform team added (like TBM) aren't billed here: you bill
them as agreed. A business that signed up and went live before you offered
plans isn't asked to pay until it chooses one.

Invoices are the platform's billing records, not tax invoices: VAT and KRA
eTIMS stay with the platform's accountant for now.

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
- With sign-up open: the sign-in page offers **Sign up your business**, and a
  test sign-up gets its confirmation email.
- With billing on: the platform page's **Billing** shows your plans and says
  whether paying online is on.
