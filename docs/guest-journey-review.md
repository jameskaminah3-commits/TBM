# Guest journey review: what was fixed, and the friend's gift

October 2026. A new guest's whole journey was run on `main` on a phone and a laptop, against a local copy with test listings: finding a villa, booking, creating an account, paying by M-Pesa through Paystack, the provider accepting and delivering, TBM following it in Admin, the guest reviewing and sharing, and a friend booking through the shared link with a discount. These are the problems found and what changed. The live site wasn't tested from here.

## Problems fixed

**Things that could cost bookings**
- **See-through bars.** Tailwind only makes colour opacities in steps of 5. Classes such as `bg-background/94` and `/92` (used in hundreds of places) produced nothing, so the sticky header and the phone Book bar were see-through: the total printed on top of the page behind it. Every whole-number opacity now works (`tailwind.config.ts`), and both phone Book bars are solid.
- **The stay page promised "Free cancellation up to 48 hours".** The cancellation policy gives at most an 80% refund, and none inside 48 hours. "24/7 customer support" and "Clear SLA agreements" weren't backed by anything either. The page now says only what TBM keeps: secure checkout, hosts approved by TBM, TBM's team on WhatsApp and phone, and "Refunds follow our cancellation policy" with a link.
- **Price and Book were hard to reach on phones.** On a stay page they were on the fourth screen of seven. A pinned bar now shows the nightly price and Book. In My Bookings, Pay now sat on the fifth screen; it now opens the unpaid booking.
- **Too many floating buttons on phones.** Zaina, "Ask Our Concierge" and a tooltip covered forms, the price and the payment button, and Zaina showed above the checkout dialog. Phones and tablets now have one helper, Zaina, who hands over to WhatsApp. Zaina sits under dialogs, and the tooltip stays quiet on booking, payment and sign-in pages.
- **"Confirmed" before payment.** The booking progress showed Confirmed as done for an unpaid booking. It now reads "Confirmed once you pay" until the booking is paid.
- **No ask for a review.** Nothing asked a guest to review, which matters because a rating only shows from 3 eligible reviews. When a stay or service is completed, the guest is now emailed a short request with a link straight to the review form. My Bookings also asks "How was …?" at the top until they review.

**Things that looked or read wrong**
- Emails led with US$ while guests browse and pay in KSh. Booking emails and receipts now lead with KSh, with US$ alongside. A receipt shows the exact KSh charged and says "Paid with: Paystack", not "Provider: …".
- Stays said "per day"; they now say "per night". "Available from 2026-10-14" now reads "today" or "Sat 14 Nov". The visible summary no longer quotes a US$ price.
- "New on TBM" had a gold star next to it, which looks like a rating; it now has a neutral icon. The host block read "New on TBMSee all their services". A hotel card read "Up to 0" guests.
- On stay pages, reviews were folded away, and with fewer than 3 reviews five grey stars looked like a zero rating. Reviews now show open, with a "Guest reviews" heading and no stars until there's a real rating.
- Laptop stay pages jumped down on load because the photo strip scrolled the page; now only the strip moves.
- Links inside links (invalid HTML) were fixed on listing and article pages.
- The sign-in page said "Continue To Book / Ux Villa Diani"; it now says "Then back to your booking".
- The sign-in and custom request pages now have proper headings and titles.
- The phone tab bar now highlights the right tab while booking.
- "Temporary M-Pesa send money" is now "Pay by M-Pesa Send Money".

**TBM's side**
- An admin booking now shows whether it's paid, how and when (with the reference), and whether each provider accepted the job.
- The site header no longer covers the top of the admin sidebar.
- The "Add Listing" menu now opens anchored correctly.
- Three React warnings were fixed (an image attribute, the admin menu, and duplicate list keys).

## The friend's gift: sharing that gives a discount

Guests can now share a stay, car, chef or experience with a discount for the friend who books through their link. It runs on the promo codes TBM already has, so there's no new tracking system.

**How to switch it on (Admin › Marketing › Promos):**
1. Create a promo with a code (for example `KARIBU10`), a percent or fixed discount, status **Active** and channel **Guest shares (friend's discount)**.
2. Under who pays, choose **Platform only** to leave providers' earnings unchanged.
3. Optionally set an end date, a minimum spend or a usage limit, as with any promo.

The newest active guest-share promo is the one used. To pause the gift, pause the promo.

**What guests see:**
- After a 4- or 5-star review: "Thank you! Know someone who'd love …? Share it on WhatsApp and they get 10% off their booking."
- When they share any listing, the sheet says "Give your friends 10% off". The WhatsApp message reads "Book through my link and you get 10% off with TBM". The link carries the code.
- The friend lands on the listing and sees "A friend's link: 10% off your booking. It's applied at checkout. Nothing to type." The code is already filled in at checkout, and the booking is recorded against the promo, with the discount and who pays for it.

**Why it's built this way:**
- The person sharing gets nothing, so it isn't a referral payment.
- Commission arrangements don't change.
- Framing it as a gift from the guest is more natural to share than asking for a reward, and it fits TBM's welcome.

## Hotels: rooms and meal plans

A stay is now either an entire place (booked whole, as before) or a hotel, which sells rooms. This came from the development branch without its site redesign.

**How to add a hotel (Admin › Add Listing › Stay):**
1. Choose **Hotel**. Fill in the name, area, description, star rating, check-in and check-out times, photos and facilities, and tick **Public Listing**.
2. Press **Create hotel, then add rooms**.
3. For each room type, press **Add room type** and fill in:
    - its name;
    - how many guests one room sleeps;
    - how many of these rooms the hotel sells through TBM;
    - the beds;
    - a price per room per night for each meal plan offered: room only, bed & breakfast, half board, full board or all inclusive. A price for one guest is optional.
4. The hotel appears on the site once it has a room with a price. Its "from" price, guests and rooms follow from its rooms.

To close some rooms, or the whole hotel, for dates, use **Close rooms or the whole hotel** on the hotel's edit page.

**What guests see:**
- **Stays page:** a Hotel badge and a filter.
- **Hotel page:** its rooms, what each meal plan includes, and how many rooms are left for their dates. The pinned phone bar says "Choose a room".
- **Checkout:** the guest picks a room, a meal plan and the number of rooms. The number of rooms is set from the number of guests, and the price is worked out as they choose.
- **My Bookings, emails and receipts:** these name the room and the meal plan.

**Rooms left:**
- A booking takes only its rooms.
- When there aren't enough rooms, the next guest is told how many are left.
- Pay now, TBM's date locks and the public calendar all count rooms.

**Zaina:** she can search and book hotel rooms.

**Database:** this adds columns to stays, bookings and stay blocks, and one table, `stay_room_types`. Nothing is removed or renamed. Existing stays become entire places.

**Also fixed while testing hotels:**
- After checkout, My Bookings opens the booking just made, with its Pay now. This applies to every service. A returning guest used to land on their earliest trip instead.
- Booking a hotel room keeps the share link's credit, like Book on any stay.
- On phones, Zaina's button steps aside on checkout, My Bookings and sign-in, so it never covers the form or Pay now.

## Tested

Done locally only, with test accounts. None of this is proof of how the live site behaves.

- **Full journey:** 40 of 40 checks passed (run again with hotels in) across the guest, provider, admin and friend on phone and laptop, with Paystack simulated. Email verification ran through a non-local host name, so the real code path was used.
- **Hotels:** 24 of 24 checks passed. In Admin, TBM created a hotel with two room types. A guest on a phone booked 2 rooms on bed & breakfast and paid by M-Pesa (simulated). One room was left. A second guest was refused 2 rooms, then booked the last one. Admin showed the room and meal plan.
- **Unit tests:** 271 passed (260, plus 11 for hotels).
- **Earlier regression suites:** results are listed in the release notes for this change.
