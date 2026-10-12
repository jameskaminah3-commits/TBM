# Google sign-in branding

**Status: not started on the live accounts.** The code and policy changes are on the dev branch. Every step below is done by the owner in Google Cloud, Google Search Console, Supabase, Apple Developer (if Apple sign-in is on) and Railway. Nobody else should need the passwords.

## The problem

When someone taps **Continue with Google**, Google's screen says:

> Google will allow **psncqnshdihabpcaurib.supabase.co** to access this info about you

There are two reasons:
- **The address.** Google sends people back to Supabase's own address (`https://psncqnshdihabpcaurib.supabase.co/auth/v1/callback`), and shows that address.
- **The name and logo.** Google shows an app's name and logo only after **brand verification**. That needs every domain on the consent screen to be owned and verified by TBM. TBM can't verify `supabase.co`, so verification can't pass while that address is used.

The fix is to have Supabase answer on TBM's own address, **auth.tembeabilamatata.com**, and then have Google verify the brand.

| Stage | What Google's screen says |
|---|---|
| Today | `psncqnshdihabpcaurib.supabase.co` |
| After step E (custom domain live) | `auth.tembeabilamatata.com` |
| After step G (brand verified) | **Tembea Bila Matata**, with the TBM logo |

## What's ready in the code (dev branch)

- **Privacy policy.** `/privacy` has a new section, "Signing In with Google or Apple". It covers what TBM receives (name, email address, profile picture), what it's used for, that it isn't sold or used for advertising, the Google API Services User Data Policy statement, and how to remove access or delete the account. Google checks this page during verification, so **it must be live before step G**.
- **Sign-in request.** The Google sign-in no longer asks for offline access, which TBM never used. Google now asks only for the basic profile.
- **Logo.** `client/public/brand/google-consent-logo-120.png` is 120 × 120 px, PNG, 4 KB, and made from the app icon. It fits Google's round crop. Download it from GitHub: `https://github.com/jameskaminah3-commits/TBM/blob/claude/clever-gates-6vv6rw/client/public/brand/google-consent-logo-120.png`.
- **No other code change is needed.** The website already reads the Supabase address from `VITE_SUPABASE_URL`, and the security policy already allows whatever that is set to.

## Order of work

| Step | Where | Can start | Users notice |
|---|---|---|---|
| A. Branding details | Google Cloud | Now | Nothing |
| B. Verify the domain | Google Search Console | Now | Nothing |
| C. Add the custom domain | Supabase and DNS | Now (paid add-on) | Nothing |
| D. Add the new return address | Google Cloud, Apple | After C is verified | Nothing |
| E. Turn it on | Supabase, then Railway | After D | Google shows `auth.tembeabilamatata.com` |
| F. Test | Browser | Straight after E | — |
| G. Tidy up and submit | Google Cloud | After F passes and `/privacy` is live | Name and logo, once Google approves |

Do D before E. If the new return address isn't registered with Google and Apple when Supabase switches to it, sign-in stops working until it is.

## A. Branding details (Google Cloud)

Sign in to Google Cloud with an account that is **Owner** or **Editor** on the project that holds TBM's Google sign-in client. To find the right project, open Supabase › Authentication › Sign In / Providers › Google and note the **Client ID**. It's the project whose Clients list shows that ID.

Go to **Google Auth Platform** (older screens call it **APIs & Services › OAuth consent screen**).

**Branding:**

| Field | Value |
|---|---|
| App name | `Tembea Bila Matata` |
| User support email | `contact@tembeabilamatata.com`. The list only offers your own Google account and Google Groups you manage. If this address isn't one of those, pick your account email for now. |
| App logo | `google-consent-logo-120.png` (above) |
| Application home page | `https://tembeabilamatata.com` |
| Privacy policy link | `https://tembeabilamatata.com/privacy` |
| Terms of service link | `https://tembeabilamatata.com/terms` |
| Authorised domains | Add `tembeabilamatata.com`. Leave `supabase.co` until step G. |
| Developer contact email | An inbox the owner reads, for example `contact@tembeabilamatata.com`. Google sends verification questions here. |

**Audience:** User type **External**. Publishing status **In production**. If it says **Testing**, only listed test users can sign in.

**Data Access:** Only these three scopes:
- `openid`
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`

Remove anything else. TBM doesn't use any other scope.

Google keeps showing the address until brand verification passes in step G. Sign-in carries on working in the meantime.

## B. Verify the domain (Google Search Console)

Use **the same Google account** as step A.

1. Go to Search Console › Add property › **Domain**, and enter `tembeabilamatata.com`.
2. Search Console gives a TXT record (`google-site-verification=…`). Add it at the DNS provider for `tembeabilamatata.com`, then press **Verify**. DNS can take from a few minutes to a few hours.

A Domain property covers every subdomain, including `auth.tembeabilamatata.com`. The site already has an HTML-tag check (`GOOGLE_SITE_VERIFICATION`). If that was done with a different Google account, it won't count for brand verification. The Domain property above is the safe choice.

## C. Add the custom domain (Supabase and DNS)

Custom domains are a **paid Supabase add-on** and need a paid plan. Check the current price under Supabase › Organization › Billing › Add-ons before turning it on.

1. Supabase › project `psncqnshdihabpcaurib` › **Project Settings › Custom Domains** (in some versions, **General › Custom Domains**). Turn on the add-on if asked.
2. Enter `auth.tembeabilamatata.com`.
3. At the DNS provider, add the records **exactly as Supabase shows them**:
   - a **CNAME** from `auth` to `psncqnshdihabpcaurib.supabase.co`;
   - one or more **TXT** records, used to verify the domain and issue its certificate.

   If the DNS is on Cloudflare, set the CNAME to **DNS only** (grey cloud), not proxied.
4. Press **Verify** (or **Reverify**) until Supabase shows the domain as verified with a certificate. This can take up to a few hours.
5. **Don't activate yet.** Go to step D first.

The same steps work from the Supabase command line:

```
supabase domains create   --project-ref psncqnshdihabpcaurib --custom-hostname auth.tembeabilamatata.com
supabase domains reverify --project-ref psncqnshdihabpcaurib
# activate comes in step E
```

## D. Add the new return address (Google, and Apple if used)

**Google:**
1. Go to Google Auth Platform › **Clients**, and open the Web client whose ID matches Supabase.
2. Under **Authorised redirect URIs**, add `https://auth.tembeabilamatata.com/auth/v1/callback`.
3. **Keep** `https://psncqnshdihabpcaurib.supabase.co/auth/v1/callback` for now.
4. Save. Changes can take a few minutes to apply.

**Apple** (only if Apple sign-in is turned on, that is, `VITE_SOCIAL_LOGIN_PROVIDERS` includes `apple`):
1. Go to Apple Developer › Certificates, IDs & Profiles › Identifiers › **Services IDs**. Open the one whose identifier matches Supabase › Authentication › Providers › Apple › Client ID.
2. Go to Sign in with Apple › Configure.
3. Under **Domains and Subdomains**, add `auth.tembeabilamatata.com`.
4. Under **Return URLs**, add `https://auth.tembeabilamatata.com/auth/v1/callback`.
5. Keep the old entries.
6. Check that the Services ID **Description** reads `Tembea Bila Matata`. Apple shows that name to people signing in.

## E. Turn it on (Supabase, then Railway)

1. **Supabase:** go to Custom Domains › **Activate**, or run `supabase domains activate --project-ref psncqnshdihabpcaurib`.

   From now on, Supabase sign-in sends people back through `auth.tembeabilamatata.com`. The old `supabase.co` address keeps working for everything else.
2. **Railway:** go to the TBM service › **Variables** and set:
   ```
   VITE_SUPABASE_URL=https://auth.tembeabilamatata.com
   ```
   Railway rebuilds and redeploys. Wait for the deploy to show **Active**. The website reads this value when it's built, so it only changes after the rebuild.
3. **Leave `SUPABASE_URL` as it is.** The server uses it to build photo links. Changing it would put new photo links on `auth.tembeabilamatata.com`, and nothing needs that.

## F. Test

Use a private (incognito) window, on a phone and on a computer.

| Check | Expected |
|---|---|
| `tembeabilamatata.com/auth` › Continue with Google | Google's screen names `auth.tembeabilamatata.com`. `supabase.co` doesn't appear. |
| Choose an account | Back on TBM, signed in, with your name shown |
| Sign out, then sign in again with Google using an existing TBM account | Same account and bookings. No duplicate account. |
| Continue with Apple (if on) | Signs in. Apple shows "Tembea Bila Matata". |
| Email and password sign-in, and the email code | Unchanged and working |
| Browser console (desktop) during sign-in | No "Content Security Policy" errors |

**If Google says `redirect_uri_mismatch`:** step D's address is missing or mistyped in the Google client. Fix it there. Nothing needs to change on the website.

**If you come back to TBM but see "Social login failed":**
1. Check the Railway logs for `/api/auth/social-session`.
2. If the error says the token is invalid, also set:
   ```
   SUPABASE_URL=https://auth.tembeabilamatata.com
   SUPABASE_MEDIA_PUBLIC_BASE_URL=https://psncqnshdihabpcaurib.supabase.co/storage/v1/object/public/<media bucket>
   ```
   The second line keeps photo links where they are.
3. Redeploy and test again.

## G. Tidy up and submit for brand verification

Before you start, the privacy-policy update must be live on `https://tembeabilamatata.com/privacy`. It's on the dev branch and needs a release.

1. **Google client:** remove `https://psncqnshdihabpcaurib.supabase.co/auth/v1/callback`. The live site no longer uses it.
2. **Branding › Authorised domains:** remove `supabase.co`. Leave only `tembeabilamatata.com`.
3. **Data Access:** confirm it still lists only the three basic scopes.
4. **Verification Center:** submit for **brand verification**.
   - It usually takes 2 to 3 working days.
   - Google writes to the developer contact email. Reply from that inbox.
   - If Google asks for a video, record the sign-in from `tembeabilamatata.com/auth`, showing Google's screen.
5. **After approval:** Google's screen says **"Sign in to continue to Tembea Bila Matata"** with the logo, and **"Google will allow Tembea Bila Matata to access this info about you"**.

Changing the app name, logo or links later needs a fresh verification.

## Rollback

- **Quick (website only):** set `VITE_SUPABASE_URL` in Railway back to `https://psncqnshdihabpcaurib.supabase.co` and redeploy. This works as long as the old return address is still in Google and Apple. If you've already done step G, add it back first.
- **Remove the custom domain:** only after the website is back on the old address. Go to Supabase › Custom Domains › remove (or `supabase domains delete --project-ref psncqnshdihabpcaurib`), then remove the add-on in Billing.

## Without the paid add-on

TBM could run its own Google sign-in on `tembeabilamatata.com`. The server would handle Google's return at `https://tembeabilamatata.com/api/auth/google/callback`, and Apple would stay on Supabase.

- **Gains:** no add-on fee, and Google shows `tembeabilamatata.com`. Brand verification works the same way.
- **Costs:**
  - new sign-in code to build and test: request checks, linking to existing accounts by email, and the session;
  - a Google client secret stored in Railway;
  - two sign-in paths to maintain instead of one.

This isn't built. It's a reasonable choice if the add-on's cost matters more than the extra code.

## Record

| Date (EAT) | Who | Step | Result | Notes |
|---|---|---|---|---|
| | | A Branding details | | |
| | | B Domain verified | | |
| | | C Custom domain verified | | |
| | | D Return address added (Google, Apple) | | |
| | | E Activated, Railway redeployed | | |
| | | F Tests | | |
| | | G Submitted, then approved | | |
