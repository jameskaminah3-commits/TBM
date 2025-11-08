# Tembea Bila Matata - Lifestyle Concierge Platform

## Overview
Tembea Bila Matata is a premium lifestyle concierge platform that seamlessly integrates luxury accommodation bookings with essential local services. The platform bridges the gap between Airbnb's convenience and hotel-style concierge service, offering guests a single booking experience with access to vetted service providers. Travel Local. Stay Easy. Live Bila Matata.

## Core Features

### Customer-Facing
- **Luxury Accommodations**: Browse and book premium properties with detailed listings and high-quality imagery
- **Curated Services**: Add-on services including car rentals (with/without drivers), personal chefs, and errand services
- **Interactive Service Browsing**: Dedicated pages for Drive, Dine, and Relax services with detailed filtering and options
- **Standalone Service Booking**: Book services independently without accommodation - perfect for locals or existing guests
- **Diverse Car Rental Options**: 6 different vehicle types including self-driven and chauffeur options with various vehicle types (sedan, SUV, luxury, van)
- **Flexible Booking Options**: Book accommodation with services OR book services alone
- **Vetted Providers**: Background-checked service professionals with clear SLA agreements
- **Booking Management**: Complete dashboard for managing both accommodation and service-only reservations
- **Public Blog**: Read travel tips, destination guides, and luxury lifestyle content

### Admin Features
- **Admin Dashboard**: Comprehensive analytics overview with metrics cards (total bookings, active bookings, revenue, booking types) and recent bookings list
- **Bookings Management**: Full CRUD operations with status/type filtering and quick status updates via dropdown
- **Blog Management**: Create, edit, and delete blog posts with markdown editor, draft/published workflow, and auto-publish logic
- **Responsive Design**: Beautiful, mobile-optimized interface following Airbnb-inspired design patterns

## Tech Stack
**Frontend:**
- React with TypeScript
- Tailwind CSS + Shadcn UI components
- Wouter for routing
- TanStack Query for data fetching
- React Hook Form with Zod validation

**Backend:**
- Express.js API
- In-memory storage (MemStorage)
- TypeScript for type safety
- Shared schema definitions

## Project Structure
```
├── client/
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── lib/            # Utilities and configurations
│   │   └── App.tsx         # Main app with routing
├── server/
│   ├── routes.ts           # API endpoints
│   └── storage.ts          # Data storage interface
├── shared/
│   └── schema.ts           # Shared TypeScript schemas
└── design_guidelines.md    # Design system documentation
```

## Design System
- **Primary Font**: Inter for body text and UI elements
- **Accent Font**: Poppins for headings and brand elements
- **Color Scheme**: Coastal travel theme
  - Primary: #0DA9A4 (Turquoise Ocean) - buttons, links, accents
  - Accent: #FF8C5A (Coral Sunset) - CTAs, highlights
  - Background: #F7F3EE (Sand) - page backgrounds
  - Text: #1F2A2E (Dark Slate) - primary text
- **Components**: Shadcn UI with coastal styling
- **Visual Style**: Modern premium with generous spacing, soft shadows, rounded corners
- **Animations**: Smooth hover effects (card lift, shadow glow)

## Data Models
- **Accommodations**: Properties with pricing, amenities, and capacity
- **Services**: Add-on services with type, pricing, descriptions, and car rental specific fields (deliveryType, vehicleType, transmission, seatingCapacity)
- **Providers**: Vetted service professionals with ratings and SLA info
- **Bookings**: Guest reservations with dates, services, and total pricing. Supports both accommodation+service bookings and standalone service bookings (accommodationId optional, bookingType: "accommodation" or "service"). Uses BookingStatus enum for type-safe status values
- **BlogPost**: Blog content with title, slug, excerpt, markdown content, featured image, author, status (draft/published), publishedAt timestamp, createdAt, and updatedAt
- **Analytics**: DashboardMetrics, PopularService, and RevenueByMonth for admin insights

## Service Types
- **Car Rentals**: 6 options including self-driven (compact sedan, luxury SUV, sports car, budget manual) and chauffeur-driven (luxury sedan, executive van)
- **Personal Chefs**: 3 options including daily chef service, breakfast chef, and special occasion chef
- **Shopping & Errands**: 4 options including grocery shopping, fridge stocking, personal shopping assistant, and laundry service

## API Routes

### Public Routes
- `GET /api/accommodations` - List all accommodations
- `GET /api/accommodations/:id` - Get specific accommodation
- `GET /api/services` - List available services (includes car rental details)
- `GET /api/providers` - List service providers (supports ?serviceType filter)
- `POST /api/bookings` - Create new booking
- `GET /api/bookings` - List user bookings
- `GET /api/blog` - List published blog posts
- `GET /api/blog/:slug` - Get individual blog post by slug

### Admin Routes
- `GET /api/admin/dashboard` - Dashboard metrics (total bookings, active bookings, revenue, booking types, recent bookings)
- `GET /api/admin/analytics/popular-services` - Popular services chart data
- `GET /api/admin/analytics/revenue` - Revenue by month chart data
- `GET /api/admin/bookings` - List all bookings (admin view)
- `PATCH /api/admin/bookings/:id` - Update booking (status updates)
- `DELETE /api/admin/bookings/:id` - Delete booking
- `GET /api/admin/blog` - List all blog posts (drafts + published)
- `GET /api/admin/blog/:id` - Get specific blog post
- `POST /api/admin/blog` - Create new blog post
- `PATCH /api/admin/blog/:id` - Update blog post
- `DELETE /api/admin/blog/:id` - Delete blog post

## Pages

### Customer Pages
- `/` - Homepage with hero, service icons, and how it works
- `/accommodations` - Browse all accommodations
- `/accommodation/:id` - Accommodation details
- `/services/drive` - Browse car rental services (self-driven & chauffeur options)
- `/services/dine` - Browse personal chef services
- `/services/relax` - Browse shopping and errand services
- `/book/:id` - Booking form for accommodation with service selection
- `/book/service/:id` - Standalone service booking form (no accommodation required)
- `/bookings` - Booking history and management (shows both accommodation and service-only bookings)
- `/blog` - Public blog listing with published posts
- `/blog/:slug` - Individual blog post detail with markdown rendering

### Admin Pages
- `/admin/dashboard` - Dashboard overview with metrics, charts, and recent bookings
- `/admin/bookings` - Bookings management with filters and status updates
- `/admin/blog` - Blog management with create/edit/delete operations

## Recent Changes (November 6, 2025)

### Session 1: Core Service Browsing
- **Branding Update**: Changed platform name to "Tembea Bila Matata" with tagline "Travel Local. Stay Easy. Live Bila Matata."
- **Homepage Redesign**: Updated hero section with "Stay + Drive + Dine + Relax — All in One Place" and added How It Works section
- **Interactive Service Icons**: Made all 4 service icons clickable with navigation to respective service pages
- **Expanded Car Rental Services**: Added 6 diverse car rental options with variety in:
  - Delivery type (self-driven vs chauffeur)
  - Vehicle type (sedan, SUV, luxury, van)
  - Transmission (automatic vs manual)
  - Seating capacity (2-8 seats)
  - Price range ($35-$300 per day)
- **Dedicated Service Pages**: Created three new browsing pages:
  - /services/drive - Car rental services with detailed specs
  - /services/dine - Personal chef and cooking services
  - /services/relax - Shopping, errands, and convenience services
- **Enhanced Schema**: Updated services schema to support car rental specific attributes

### Session 2: Standalone Service Booking
- **Independent Service Purchasing**: Users can now book services without accommodation
- **New Booking Page**: Created /book/service/:id for standalone service bookings with:
  - Service details and pricing display
  - Start/end date selection
  - Guest information form
  - Dynamic price calculation (per-day vs one-time services)
  - Real-time booking summary
- **Schema Enhancement**: Made accommodationId optional in bookings, added bookingType field
- **Bookings Page Update**: Now displays both accommodation+service and service-only bookings with distinct UI for each type
- **Complete Integration**: All "Book Now" buttons on service pages navigate to standalone booking flow
- **Full E2E Testing**: Complete booking flow tested from service selection through booking confirmation

### Session 3: Admin Dashboard & Blog System (November 6, 2025)
- **Admin Layout**: Created AdminLayout with Shadcn Sidebar component for consistent admin navigation
- **Admin Dashboard** (`/admin/dashboard`):
  - 5 metrics cards: Total Bookings, Active Bookings, Total Revenue (USD formatted), Accommodation Bookings, Service-Only Bookings
  - Recent bookings list showing 5 most recent reservations
  - Full TypeScript typing for dashboard metrics
- **Admin Bookings Management** (`/admin/bookings`):
  - Client-side filtering by status (all, upcoming, in-progress, completed, cancelled) and type (all, accommodation, service)
  - Quick status updates via dropdown on each booking card
  - Empty state handling for filtered results
  - Real-time result count display
- **Admin Blog Management** (`/admin/blog`):
  - Full CRUD operations: create, edit, delete blog posts
  - Modal-based forms with react-hook-form and Zod validation
  - Markdown content editor for rich text posts
  - Draft/published workflow with auto-publish logic
  - Featured image support (optional)
  - Auto-generated slugs from titles
- **Public Blog System**:
  - `/blog` listing page with published posts in card grid
  - `/blog/:slug` detail page with markdown rendering (react-markdown + remark-gfm)
  - Blog link added to main header navigation
  - Posts only visible when status="published" AND publishedAt is set
- **Schema Enhancements**:
  - Added BlogPost model with full metadata (title, slug, excerpt, contentMarkdown, author, status, publishedAt, etc.)
  - Added BookingStatus enum for type-safe status handling
  - Added analytics types: DashboardMetrics, PopularService, RevenueByMonth
- **Auto-Publish Logic**:
  - Creating post with status="published" automatically sets publishedAt to current timestamp
  - Updating post to status="published" auto-sets publishedAt if missing
  - Ensures published posts appear immediately in public API without manual date entry
- **Bug Fixes**:
  - Fixed apiRequest parameter order in admin pages (method, url, data)
  - Fixed blog post visibility: auto-setting publishedAt prevents published posts from being hidden
- **Package Additions**: Installed react-markdown and remark-gfm for markdown rendering
- **E2E Testing**: Comprehensive end-to-end testing of all admin and public blog features confirmed working

### Session 4: Coastal Visual Redesign (November 8, 2025)
- **Brand Color System**: Implemented coastal travel theme with turquoise, coral, and sand palette
- **Typography Update**: Switched to Poppins for headings, retained Inter for body text
- **Homepage Redesign**:
  - New hero headline: "Tembea Bila Matata — Travel Without Worries"
  - Enlarged service cards with hover animations (lift + shadow glow)
  - Rounded corners (xl) and soft drop shadows throughout
  - "Explore Services" CTA in coral accent color
  - Enhanced "Why Tembea Bila Matata" section with 4 features
  - New footer with brand info, contact, and social links
- **Visual Enhancements**:
  - Increased spacing (py-20, py-24 for sections)
  - Smooth transitions (300ms) on all interactive elements
  - Card hover effects: -translate-y-2 + shadow-2xl
  - Backdrop blur on hero search widget
  - Circular icon backgrounds with primary/15 opacity
- **Responsive Design**: All grids collapse to single column on mobile, touch-friendly buttons
- **Design Guidelines**: Complete overhaul of design_guidelines.md with coastal theme specifications

## Navigation & User Experience

### Main Navigation (Lifestyle Terms)
The website uses lifestyle-focused navigation terminology:
- **Home** - Homepage with hero and platform overview
- **Stay** - Browse luxury BnBs and accommodations
- **Drive** - Car rental services (self-drive and chauffeur)
- **Dine** - Personal chef and cooking services
- **Relax** - Errands and personal assistance services
- **Blog** - Travel tips and lifestyle content
- **My Bookings** - Manage all reservations

### User Experience Highlights
- Hero section with immersive background imagery
- Card-based accommodation browsing with hover effects
- Detailed property pages with amenities and service add-ons
- Multi-step booking flow with real-time price calculation
- Booking management dashboard with status tracking
- Trust indicators throughout (verified badges, SLA guarantees)

## Development Notes
- Uses in-memory storage for MVP (no database required)
- All routes use proper TypeScript typing
- Form validation with Zod schemas
- Responsive breakpoints: mobile (<768px), tablet (768-1024px), desktop (>1024px)
- Image assets generated using AI for hero and property listings
