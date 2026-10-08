# Tembea Bila Matata: Design Guide

How the guest-facing site looks, reads and behaves. Follow it for new pages and
when changing old ones. The admin and partner dashboards follow the same tokens
but are not bound by the guest patterns below.

---

## What the site has to say

Tembea Bila Matata means "travel without worries". The site sells one promise:
**the Coast trip, sorted by people on the ground who check things first.** Stays,
rides, private chefs, help at the stay, days out, and checking a listing found
somewhere else, along the Kenyan Coast.

- Lead with what guests get and what we check, not with features.
- The home and About pages tell the owner's story in the owner's words. They
  read it from `client/src/lib/brand-story.ts`; change the words there, once.
- No dead ends. When a list runs out, offer Zaina or a custom request
  (`CustomServiceCta`), never an empty page.

---

## Words

- **Sentence case** for buttons, labels, form fields, chips and section
  headings: "Book now", "Pay today", "Your trip". Page titles (`h1`) and the
  legal pages may keep title case.
- Plain words guests use: "a night", "Pay today", "Your trip", "Home help",
  "Sign in". Not "accommodation inventory", "SLA", "service location".
- Say the price for the whole stay or service once dates are known, and say
  what is due today. Never hide the commitment.
- Kenyan English and conventions: day-first dates ("12 Dec – 15 Dec"), KSh and
  US$, "8am to 8pm".
- Prices start in the visitor's currency: KSh in Kenya, US$ elsewhere. Use
  `useCurrency()` and `CurrencyAmount`; never format money by hand.
- The same facts in the same words everywhere. Reply time: "Our team replies
  within a few hours, Monday to Saturday, 8am to 8pm. Zaina answers any time."
  Cancellation lines come from `shared/cancellation-policy.ts`.
- Text written for search engines belongs in the page metadata
  (`shared/page-metadata.ts`, `SeoHead`), not on the page.

---

## Colour

Tokens live in `client/src/index.css` (light and dark). Use the Tailwind names,
never raw hex values in components.

| Token | Light | Use |
|---|---|---|
| `primary` | #257174, deep teal | Main actions, links, selected states, focus ring |
| `background` | #F9F1E7, sand | Page background |
| `card` | #FEFBF6 | Cards, panels, inputs on sand |
| `foreground` | #202B37, dark slate | Text |
| `muted-foreground` | #5A6672 | Secondary text. Don't fade it further with `/70`: it fails contrast |
| `accent` | #F4B26C, warm sand-gold | Small highlights only, never body text |
| `border` | #DDD0C0 | Borders and dividers |
| `destructive` | #C52020 | Errors and destructive actions |

Dark mode swaps in a navy background (#131A25) and a brighter teal (#3BB6BA).
Check every new screen in both.

Text must reach 4.5:1 contrast (3:1 for large text). Status colours (emerald
for paid, amber for pending) are for badges and icons, with the meaning also in
words.

---

## Type

Both families are self-hosted from `client/public/fonts` (SIL Open Font
Licence), declared at the top of `index.css` and preloaded in `index.html`. Do
not add Google Fonts or other font CDNs back.

- **Cormorant Garamond** (`font-serif`, 400 to 700): page titles, section
  titles, prices in summaries. Medium weight, `leading-tight`.
- **Plus Jakarta Sans** (`font-sans`, 200 to 800): everything else.

| Role | Classes |
|---|---|
| Page title (`h1`) | `font-serif text-[2rem] sm:text-5xl font-medium leading-[1.1]` |
| Section title (`h2`) | `font-serif text-2xl sm:text-3xl font-medium` |
| Eyebrow above a title | `text-xs font-semibold uppercase tracking-[0.2em] text-primary` |
| Card or item title | `text-base font-semibold` |
| Body | `text-base leading-7` (lead paragraphs `sm:text-lg`) |
| Helper and fine print | `text-sm leading-6 text-muted-foreground` |

Inputs use `text-base` on phones so iOS doesn't zoom in.

---

## Layout

- Phone first. Design at 390 px, then 768, 1024 and 1440. Nothing may scroll
  sideways at 390 px.
- Containers: `container mx-auto px-4 md:px-8` with `max-w-3xl` for forms,
  `max-w-5xl` for content pages, `max-w-6xl` or wider for results.
- Section rhythm: `py-10 md:py-16`; a hero band uses `border-b bg-muted/30`.
- Rounded corners: cards `rounded-[1.25rem]` to `rounded-[1.5rem]`, buttons and
  chips `rounded-full`, inputs `rounded-lg`.
- Below 1280 px the mobile tab bar is fixed at the bottom. Anything else pinned
  to the bottom sits above it:
  `fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 lg:hidden`.
  On listing pages the Zaina launcher is lifted with `.zaina-lifted` so it
  never covers a pinned Book bar.

---

## Components and patterns

Reuse these before building anything new.

| Pattern | Where | Notes |
|---|---|---|
| Listing card | `components/listing-card.tsx` | One card for stays, cars, chefs, help and experiences. The title link stretches over the card; the photo swipes; WhatsApp share sits on top. Badge, rating, details and price (`ListingPrice`) are props. |
| Photo gallery | `components/premium-media-gallery.tsx` | Mosaic on a listing page, swipe carousel in a card (`variant="card"`), full-screen lightbox. Pass `imageSizes` so phones get small images. |
| Date range picker | `components/date-range-picker.tsx` | The only date picker for stays and multi-day services. Shows booked nights crossed out; a full-screen sheet on phones. `DatePicker` is the single-day version. |
| Pinned Book bar | stay, listing and checkout pages | On phones: price, what's due today and one button, pinned above the tab bar. |
| Trip plan checkout | `pages/booking.tsx`, `pages/service-booking.tsx` | One total, the commitment due today (default 50%, the admin can vary it) and the balance, then payment. |
| Trip page | `pages/bookings.tsx` | Each booking shows its next step, what's paid and due, and "Add to trip". |
| Custom request | `components/custom-service-cta.tsx`, `pages/custom-service-request.tsx` | The way out when nothing fits: Ask Zaina or send a request with a budget. |
| Zaina front door | `lib/zaina.ts` (`openZaina`) | Open Zaina with a starting message that says what the guest was doing. Never change the live Zaina widget from a page. |
| Payment marks | `components/site-footer.tsx`, `components/payment-provider-picker.tsx` | M-Pesa, Visa, Mastercard, Apple Pay. Only methods the checkout really offers. |
| Proof near the price | stay and listing pages | Reviews with first name and month (`public-review-preview.tsx`), the cancellation line, what was checked. |
| Not found | `pages/not-found.tsx` | Unknown links get a real 404 from the server and this page: home, or ask Zaina. |

Buttons: `Button` from `components/ui/button`, `rounded-full`. One main
action per screen in `primary`; the rest `outline` or `ghost`.

Choices of 2 to 6 options are chips (`role="radio"` in a `radiogroup`, or Radix
`RadioGroup`), not dropdowns. Dropdowns are for long lists.

---

## Accessibility

Every page must pass axe (WCAG 2.2 AA and best practice) on a phone and a
desktop. In practice:

- **Tap targets at least 44 px** (`min-h-11`, icon buttons `h-11 w-11`) on
  phones. Links inside running text are the only exception.
- **Every control has a name.** Icon-only buttons get `aria-label`; decorative
  icons get `aria-hidden="true"`. When a control also shows text, its name
  starts with or contains that text (the date pickers put their label in an
  `sr-only` span instead of an `aria-label`).
- **One `h1` per page, no skipped levels.** Listing cards use `h2` on results
  pages. The footer uses `h2` for its columns.
- **Landmarks:** one `main` (in `App.tsx`; pages never add their own), the
  header, the footer, labelled `nav`s, and the concierge search as a `search`
  landmark. Carousels and repeated regions get an `aria-label`.
- Star ratings: `role="img"` with an `aria-label` such as "5 out of 5 stars".
- Visible focus rings (`focus-visible:ring-2 ring-ring`). Never remove an
  outline without replacing it.
- Form errors appear under the field, in words, and the form scrolls to the
  first one.

---

## Speed

Measured on a slow 4G phone, a page should show its main content in under
3 seconds.

- No render-blocking third parties. Fonts are self-hosted and preloaded.
- Images: WebP where possible, `width` and `height` set, `loading="lazy"` below
  the fold, `sizes` on anything in a grid. Only the first visible image is
  eager, with `fetchpriority="high"` on the home hero.
- Load heavy or rare code on demand (`lazy()` routes, dynamic `import()` for
  Supabase on sign-out, the admin Zaina bubble).
- The server compresses responses and lets browsers keep hashed assets for a
  year; HTML is checked with the server on every visit.

---

## Before a page ships

1. Phone (390 px) and desktop (1440 px), light and dark, with real-length text.
2. Nothing scrolls sideways; nothing hides behind the tab bar or Zaina.
3. axe is clean; every control is at least 44 px on a phone.
4. Prices show in KSh and in US$, with the total and what is due today.
5. The page has a title and description in `shared/page-metadata.ts` (fixed
   pages) or through `SeoHead` (listings), and is listed in
   `shared/app-routes.ts` so the server doesn't answer it with a 404.
