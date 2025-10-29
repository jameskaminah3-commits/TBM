# Lifestyle Concierge Platform - Design Guidelines

## Design Approach

**Selected Approach:** Reference-Based (Airbnb + Luxury Concierge Hybrid)

**Primary References:**
- Airbnb: For accommodation browsing, card layouts, and booking flows
- Luxury hotel websites (Four Seasons, Ritz-Carlton): For premium concierge service presentation
- Linear: For clean typography and information hierarchy in dashboard areas

**Core Principles:**
1. **Aspirational Yet Accessible:** Evoke luxury without intimidation
2. **Trust Through Transparency:** Clear pricing, SLA indicators, provider credentials prominent
3. **Simplified Complexity:** Multi-service booking feels effortless despite backend complexity
4. **Visual Storytelling:** Images sell the lifestyle, not just the accommodation

---

## Typography

**Font System:** Google Fonts via CDN
- **Primary Font:** Inter (400, 500, 600, 700) - Clean, modern, excellent readability
- **Accent Font:** Playfair Display (600, 700) - For hero headlines and luxury touchpoints

**Hierarchy:**
- **Hero Headlines:** Playfair Display, 4xl to 6xl (56-72px), font-semibold, leading-tight
- **Section Titles:** Inter, 3xl to 4xl (36-48px), font-semibold, leading-tight
- **Card Titles:** Inter, xl to 2xl (24-32px), font-semibold
- **Body Text:** Inter, base to lg (16-18px), font-normal, leading-relaxed
- **Metadata/Labels:** Inter, sm to base (14-16px), font-medium
- **Fine Print/SLA Terms:** Inter, xs to sm (12-14px), font-normal

---

## Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, 8, 12, 16, 20, 24
- **Micro spacing:** p-2, gap-2 (buttons, icons, tight elements)
- **Component spacing:** p-4, p-6, gap-4, gap-6 (cards, forms)
- **Section padding:** py-12, py-16, py-20 (mobile to desktop)
- **Major spacing:** mb-8, mb-12, mb-16 (section breaks)

**Grid System:**
- **Accommodation Cards:** grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4
- **Service Selection:** grid-cols-1 md:grid-cols-2 lg:grid-cols-3 (during booking)
- **Provider Profiles:** grid-cols-1 md:grid-cols-2 (detailed cards)
- **Dashboard Layout:** 2-column split on desktop (sidebar + main content)

**Container Widths:**
- **Hero/Full-width sections:** w-full with inner max-w-7xl px-4 md:px-8
- **Content sections:** max-w-6xl mx-auto px-4
- **Reading content:** max-w-4xl mx-auto

---

## Component Library

### Navigation
**Header:** Sticky top navigation with logo left, search bar center (desktop), account/menu right. On mobile: logo left, hamburger right, search expands into full-width below.
- Height: h-16 to h-20
- Search bar: Rounded-full, shadow-sm, icon left
- User menu: Avatar + dropdown with booking history, favorites, settings

### Hero Section
**Layout:** Full-viewport-height hero (min-h-screen) with large background image
- Centered content overlay with headline + subheading + primary CTA
- Search widget positioned prominently (centered or bottom-aligned card)
- Subtle gradient overlay for text readability

**Search Widget:** Elevated card (shadow-xl) containing:
- Destination input (autocomplete)
- Check-in/Check-out date pickers (calendar icon)
- Guest count selector
- "Search" button (rounded-lg, w-full on mobile)

### Accommodation Cards
**Structure:** Vertical card with 4:3 aspect ratio image, rounded-xl, shadow-md, hover:shadow-xl transition
- Image carousel with dots indicator
- Wishlist heart icon (top-right absolute positioning)
- Title, location, rating stars, price per night
- Service badges (if car rental/cook included): Small pills below title

### Service Selection Cards (Booking Flow)
**Layout:** 3-column grid of service categories
- Icon at top (via Heroicons)
- Service name and brief description
- Checkbox or toggle switch for selection
- "View Providers" link to see vetted options
- Pricing displayed clearly (per service, per day)

### Provider Profiles
**Layout:** 2-column cards with provider photo left, details right
- Name, rating (stars + review count), years of experience
- Service description (2-3 lines)
- Availability indicator (green dot for available)
- "View Full Profile" button
- Trust badges: Verified, Background Check, SLA Agreement

### Booking Summary Panel
**Fixed Sidebar (Desktop) / Sticky Bottom (Mobile):**
- Accommodation thumbnail + name
- Selected services with individual pricing
- Dates and guest count
- Subtotal, service fees, total
- Primary CTA: "Confirm & Pay"
- Secondary link: "View Cancellation Policy"

### Dashboard Components
**Booking Cards:** Timeline-style layout
- Accommodation image thumbnail (left)
- Booking details (center): dates, services, provider assignments
- Status badge (Upcoming, In Progress, Completed)
- Quick actions: "Modify Services", "Contact Provider", "View Receipt"

**Service Provider Directory:**
- Filter sidebar: Service type, rating, availability, price range
- Results grid: Provider cards with photo, rating, specialties
- Sort options: Rating, Experience, Price

### Trust Elements
**SLA Indicators:** Small badge components showing:
- Response time guarantee (e.g., "24hr response")
- Cancellation flexibility
- Quality assurance seal

**Review Cards:**
- Guest photo + name
- Star rating
- Review text (expandable)
- Booking details: "Stayed in [City], [Month Year]"
- Services used indicator

### Forms
**Booking Form:** Multi-step wizard
- Step indicators at top (numbered circles with connecting lines)
- Section headers with Inter font-semibold
- Input fields: rounded-lg, border focus state with ring
- Helper text below inputs (text-sm)
- Navigation: "Back" + "Continue" buttons

---

## Images

**Hero Image:** Full-width, high-quality lifestyle photograph showing a luxurious accommodation with local context (beach villa, mountain cabin, city penthouse). Image should evoke aspiration and relaxation. Dimensions: 1920x1080 minimum.

**Accommodation Listings:** Multiple images per property (4-8), showcasing:
- Exterior/arrival view
- Living spaces
- Bedroom(s)
- Kitchen/dining
- Unique features (pool, view, outdoor space)

**Service Provider Photos:** Professional headshots or action shots (chef cooking, driver with vehicle). Square format, 400x400px minimum.

**Trust Signals:** Small badge graphics for certifications, SLA seals (can use icon fonts initially, replaced with brand assets later).

**Background Textures:** Subtle, abstract patterns for section breaks or empty states (optional, use sparingly).

**Icons:** Heroicons (outline for default, solid for active states) for all UI icons - services, amenities, navigation.

---

## Responsive Behavior

**Breakpoints:**
- Mobile: < 768px (single column, stacked layout)
- Tablet: 768px - 1024px (2-column grids)
- Desktop: > 1024px (3-4 column grids, sidebar layouts)

**Mobile Priorities:**
- Hero search widget simplified (fewer fields, expand on tap)
- Booking summary becomes sticky bottom sheet
- Image carousels become swipeable
- Filters collapse into drawer
- Provider profiles stack vertically

---

## Key Interactions

**Minimal Animation:**
- Card hover: Subtle scale (scale-105) + shadow increase
- Button hover: Slight opacity/brightness shift
- Page transitions: Simple fade (200ms)
- Image carousel: Smooth slide transition

**No Animations:**
- Scroll-triggered effects
- Complex parallax
- Loading spinners (use simple pulse)