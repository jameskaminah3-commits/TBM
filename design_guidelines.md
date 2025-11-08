# Coastal Travel Platform - Design Guidelines

## Design Approach

**Selected Approach:** Modern Premium Coastal Travel Theme

**Brand Identity:**
- Tembea Bila Matata: Travel Without Worries
- Tagline: "Stays, Cars, Cooks, and Errands — all in one place"
- Lifestyle-focused navigation and coastal aesthetic

**Core Principles:**
1. **Coastal Luxury:** Evoke seaside tranquility with turquoise, coral, and sand tones
2. **Modern & Premium:** Clean layouts with generous spacing and soft shadows
3. **Trust Through Design:** Professional appearance with verified service indicators
4. **Mobile-First Responsive:** Seamless experience across all devices

---

## Color Palette

**Brand Colors:**
- **Primary:** #0DA9A4 (Turquoise Ocean) - HSL(178, 86%, 36%)
  - Used for CTAs, links, and brand accents
- **Accent:** #FF8C5A (Coral Sunset) - HSL(18, 100%, 68%)
  - Used for secondary CTAs, highlights, and hover states
- **Background:** #F7F3EE (Sand) - HSL(33, 38%, 95%)
  - Main page background color
- **Text:** #1F2A2E (Dark Slate) - HSL(196, 19%, 15%)
  - Primary text color

**Supporting Colors:**
- **Light Neutrals:** Soft grays and off-whites for cards and sections
- **Overlay Gradients:** Dark gradients over hero images for text readability

---

## Typography

**Font System:** Google Fonts via CDN
- **Headings:** Poppins (400, 500, 600, 700) - Modern, clean, geometric
- **Body:** Inter (400, 500, 600) - Excellent readability for long-form content

**Hierarchy:**
- **Hero Headlines:** Poppins, 3xl to 6xl (48-72px), font-semibold, leading-tight
- **Section Titles:** Poppins, 2xl to 4xl (32-48px), font-semibold
- **Card Titles:** Poppins, xl to 2xl (20-32px), font-medium
- **Body Text:** Inter, base to lg (16-18px), font-normal, leading-relaxed
- **Metadata/Labels:** Inter, sm to base (14-16px), font-medium
- **Fine Print:** Inter, xs to sm (12-14px), font-normal

---

## Layout System

**Spacing Primitives:** Generous spacing for modern feel
- **Micro spacing:** gap-2, gap-3 (8-12px)
- **Component spacing:** p-6, p-8, gap-6 (24-32px)
- **Section padding:** py-16, py-20, py-24 (64-96px desktop)
- **Major spacing:** mb-12, mb-16, mb-20 (section breaks)

**Grid System:**
- **Service Cards:** grid-cols-1 md:grid-cols-2 lg:grid-cols-4 (equal columns)
- **Feature Cards:** grid-cols-1 md:grid-cols-3 (3-column layout)
- **Content Cards:** grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- **Mobile:** All grids collapse to single column

**Container Widths:**
- **Hero sections:** w-full with inner max-w-7xl px-4 md:px-8
- **Content sections:** max-w-6xl mx-auto px-4 md:px-8
- **Reading content:** max-w-4xl mx-auto

---

## Component Library

### Navigation
**Header:** Sticky navigation with transparency
- Height: h-16
- Subtle backdrop blur
- Logo left, navigation center, theme toggle right
- On mobile: Logo left, hamburger menu right

### Hero Section
**Layout:** Full-width hero with coastal beach image
- Large headline: "Tembea Bila Matata — Travel Without Worries"
- Sub-headline: "Stays, Cars, Cooks, and Errands — all in one place"
- CTA button in accent color
- Dark gradient overlay for text readability

**Search Widget:** Elevated card with backdrop blur
- Destination, check-in, check-out, guests
- Rounded corners (rounded-xl)
- Soft shadows (shadow-xl)

### Service Cards
**Layout:** Large clickable cards for each service
- **Stays, Drive, Dine, Relax**
- Coastal-themed images or large icons
- Title in Poppins font
- Short descriptive text
- Rounded corners (rounded-xl)
- Soft shadows (shadow-md)
- Hover: Lift effect + glow (transform + shadow-lg)
- Responsive grid: 1 column mobile, 2 tablet, 4 desktop

### "Why Choose Us" Section
**Layout:** 4-column feature grid
- Icons with circular backgrounds
- Feature title in Poppins
- Description text in Inter
- Sand background (#F7F3EE)
- Even spacing between items
- Mobile: Single column stack

### Footer
**Layout:** Clean footer with brand info
- Brand name "Tembea Bila Matata"
- Tagline
- WhatsApp contact link
- Social media icons
- Copyright notice
- Sand background

---

## Images & Visual Elements

**Hero Image:** Beach house, coastal villa, or vacation setting
- Full-width, high-quality
- Dimensions: 1920x1080 minimum
- Dark gradient overlay for text contrast

**Service Card Images:** Coastal-themed imagery
- Beaches, cars, local cuisine, lifestyle
- Consistent aspect ratio (4:3 or 16:9)
- Soft corners matching card border-radius

**Icons:** Lucide React icons
- Outline style for default state
- Consistent sizing (h-10 w-10 for large features)
- Turquoise primary color

---

## Responsive Behavior

**Breakpoints:**
- Mobile: < 768px (single column, stacked)
- Tablet: 768px - 1024px (2 columns)
- Desktop: > 1024px (3-4 columns)

**Mobile Priorities:**
- Service cards stack vertically
- Hero search form simplified
- All grids become single column
- Touch-friendly button sizes (min-h-12)
- Reduced padding for smaller screens

---

## Interactions & Animations

**Smooth Hover Effects:**
- Buttons: Subtle lift (translateY)
- Cards: Scale + shadow increase (scale-105 + shadow-lg)
- Links: Color transition to accent
- Transition duration: 200-300ms

**Scroll Animations:**
- Fade-in on scroll for sections
- Smooth reveal for content cards

**Button Styles:**
- Rounded corners (rounded-lg to rounded-xl, 8-12px)
- Accent color for primary CTAs
- Border-style for secondary actions
- Ghost style for tertiary actions

---

## Key Design Features

**Coastal Aesthetic:**
- Turquoise and coral accent colors
- Sand-toned backgrounds
- Beach/ocean imagery
- Light, airy spacing
- Soft, inviting shadows

**Premium Feel:**
- Generous whitespace
- High-quality imagery
- Professional typography
- Subtle animations
- Clean, modern layouts

**Trust Signals:**
- Verified badges
- SLA indicators
- Professional service cards
- Clear pricing
- Transparent information

---

## Implementation Notes

- Use Tailwind CSS for all styling
- Apply coastal color variables from index.css
- Ensure all interactive elements have hover states
- Maintain consistent spacing throughout
- Test on mobile, tablet, and desktop viewports
- Optimize images for web performance
