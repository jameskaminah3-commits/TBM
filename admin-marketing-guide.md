# Admin Marketing Guide

## Purpose

The admin marketing section is meant to do two jobs:

1. Create and manage promos that can affect booking value.
2. Show which content and promo-driven journeys are turning into bookings and revenue.

## What the current marketing system does

### 1. Promo management

Admins can create three promo types:

- `percent`: percentage discount
- `fixed`: fixed-value discount
- `bundle`: bundle offer with qualification rules

Each promo can include:

- name and optional promo code
- channel and audience
- landing path
- usage limit
- date window
- discount value
- eligible categories
- bundle qualification rules such as required categories, nights, guests, or bundled service count

Bundle promos can also be set to `autoApply`, which lets them activate without a promo code when the booking matches the rules.

### 2. Promo application in booking

During booking, the app checks the active promo list and evaluates:

- promo status
- date window
- category eligibility
- minimum spend
- bundle requirements
- whether a code is required or the bundle can auto-apply

If multiple promos qualify, the system prefers the strongest qualifying discount.

### 3. Attribution tracking

The marketing flow stores attribution context in the browser and carries it into booking.

Current tracked sources include:

- blog article views
- blog CTA clicks
- promo or campaign parameters carried into booking pages
- booking records that complete with attribution attached

Tracked context may include:

- session id
- source type
- source id / slug
- source path
- promo code
- UTM fields

When a booking is created, the booking attribution record stores:

- source details
- promo used
- original subtotal
- discount amount
- final revenue

## What the admin marketing page shows

### Promo Studio

This is the operations area for:

- creating promos
- filtering promos
- editing promos
- deleting promos
- reviewing usage, revenue, targeting, and bundle conditions

### Revenue Pace

Shows recent booking revenue trend from admin analytics.

### Demand to Amplify

Shows top-booked services that may deserve stronger promotion or bundling.

### Content Performance

Shows:

- post publishing health
- SEO readiness
- CTA readiness
- stale content
- top content drivers from attribution data

### Attribution Funnel

Shows:

- tracked views
- CTA clicks
- attributed bookings
- attributed discount
- top promo winners

## Mobile and responsiveness status

The page now behaves better on phones by:

- avoiding hard page failure when one analytics query errors
- keeping promo management usable even if some insight blocks fail
- reducing narrow-screen squeeze in the attribution stat layouts
- making popular-service rows stack more cleanly on smaller screens
- improving chart label spacing for small widths

## Current limitations

The section is functional, but there are still a few product-level limits worth knowing:

1. Attribution is strongest for blog-to-booking and promo-to-booking flows. It is not yet a full multi-touch marketing system.
2. Campaign views are now captured more reliably when users land in booking flows with marketing context, but not every possible landing page in the site is instrumented as a marketing entry point.
3. Metrics are operational and useful, but they are not yet deduplicated like a dedicated analytics product would do.
4. The page depends on several admin APIs. It now degrades gracefully, but missing data still means some insight blocks can be partially unavailable.

## Recommended next improvements

If you want the section to become more decision-grade for marketing, the next best upgrades are:

1. Track marketing entry views on more landing pages, not only blog and booking flows.
2. Add conversion rates to the funnel, not only raw counts.
3. Add date-range filtering so marketing can compare weekly or campaign windows.
4. Add source/channel breakouts for UTM campaigns.
5. Add promo performance by status and by landing path.
