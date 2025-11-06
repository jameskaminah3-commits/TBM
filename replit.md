# Tembea Bila Matata - Lifestyle Concierge Platform

## Overview
Tembea Bila Matata is a premium lifestyle concierge platform that seamlessly integrates luxury accommodation bookings with essential local services. The platform bridges the gap between Airbnb's convenience and hotel-style concierge service, offering guests a single booking experience with access to vetted service providers. Travel Local. Stay Easy. Live Bila Matata.

## Core Features
- **Luxury Accommodations**: Browse and book premium properties with detailed listings and high-quality imagery
- **Curated Services**: Add-on services including car rentals (with/without drivers), personal chefs, and errand services
- **Interactive Service Browsing**: Dedicated pages for Drive, Dine, and Relax services with detailed filtering and options
- **Standalone Service Booking**: Book services independently without accommodation - perfect for locals or existing guests
- **Diverse Car Rental Options**: 6 different vehicle types including self-driven and chauffeur options with various vehicle types (sedan, SUV, luxury, van)
- **Flexible Booking Options**: Book accommodation with services OR book services alone
- **Vetted Providers**: Background-checked service professionals with clear SLA agreements
- **Booking Management**: Complete dashboard for managing both accommodation and service-only reservations
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
- **Primary Font**: Inter for UI elements
- **Accent Font**: Playfair Display for headlines
- **Color Scheme**: Professional blue primary with neutral grays
- **Components**: Shadcn UI with custom styling
- **Theme**: Light/Dark mode support

## Data Models
- **Accommodations**: Properties with pricing, amenities, and capacity
- **Services**: Add-on services with type, pricing, descriptions, and car rental specific fields (deliveryType, vehicleType, transmission, seatingCapacity)
- **Providers**: Vetted service professionals with ratings and SLA info
- **Bookings**: Guest reservations with dates, services, and total pricing. Supports both accommodation+service bookings and standalone service bookings (accommodationId optional, bookingType: "accommodation" or "service")

## Service Types
- **Car Rentals**: 6 options including self-driven (compact sedan, luxury SUV, sports car, budget manual) and chauffeur-driven (luxury sedan, executive van)
- **Personal Chefs**: 3 options including daily chef service, breakfast chef, and special occasion chef
- **Shopping & Errands**: 4 options including grocery shopping, fridge stocking, personal shopping assistant, and laundry service

## API Routes
- `GET /api/accommodations` - List all accommodations
- `GET /api/accommodations/:id` - Get specific accommodation
- `GET /api/services` - List available services (includes car rental details)
- `GET /api/providers` - List service providers (supports ?serviceType filter)
- `POST /api/bookings` - Create new booking
- `GET /api/bookings` - List user bookings

## Pages
- `/` - Homepage with hero, service icons, and how it works
- `/accommodations` - Browse all accommodations
- `/accommodation/:id` - Accommodation details
- `/services/drive` - Browse car rental services (self-driven & chauffeur options)
- `/services/dine` - Browse personal chef services
- `/services/relax` - Browse shopping and errand services
- `/book/:id` - Booking form for accommodation with service selection
- `/book/service/:id` - Standalone service booking form (no accommodation required)
- `/bookings` - Booking history and management (shows both accommodation and service-only bookings)

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

## User Experience Highlights
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
