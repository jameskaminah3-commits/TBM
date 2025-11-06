# Tembea Bila Matata - Lifestyle Concierge Platform

## Overview
Tembea Bila Matata is a premium lifestyle concierge platform that seamlessly integrates luxury accommodation bookings with essential local services. The platform bridges the gap between Airbnb's convenience and hotel-style concierge service, offering guests a single booking experience with access to vetted service providers. Travel Local. Stay Easy. Live Bila Matata.

## Core Features
- **Luxury Accommodations**: Browse and book premium properties with detailed listings and high-quality imagery
- **Curated Services**: Add-on services including car rentals (with/without drivers), personal chefs, and errand services
- **Single Checkout**: One booking, one payment for accommodation and all selected services
- **Vetted Providers**: Background-checked service professionals with clear SLA agreements
- **Booking Management**: Complete dashboard for managing reservations and services
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
- **Services**: Add-on services with type, pricing, and descriptions
- **Providers**: Vetted service professionals with ratings and SLA info
- **Bookings**: Guest reservations with dates, services, and total pricing

## API Routes
- `GET /api/accommodations` - List all accommodations
- `GET /api/accommodations/:id` - Get specific accommodation
- `GET /api/services` - List available services
- `GET /api/providers` - List service providers
- `POST /api/bookings` - Create new booking
- `GET /api/bookings` - List user bookings

## Recent Changes
- Initial project setup with complete schema definitions
- Created all frontend pages with exceptional visual design
- Implemented booking flow with service selection
- Added seeded sample data for accommodations and services
- Configured theme system with light/dark mode support

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
