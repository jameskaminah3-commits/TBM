# Tembea Bila Matata - Lifestyle Concierge Platform

## Overview
Tembea Bila Matata is a premium lifestyle concierge platform offering seamless integration of luxury accommodation bookings with essential local services. It aims to bridge the gap between convenient booking and hotel-style concierge service, providing a single platform for guests to access vetted service providers. The vision is to enable users to "Travel Local. Stay Easy. Live Bila Matata." by simplifying the booking process for accommodations, car rentals, personal chefs, and errand services, thereby making travel and local experiences effortless.

## User Preferences
I prefer simple language and detailed explanations. I want iterative development with frequent check-ins. Ask before making major changes to the codebase. Do not make changes to the `shared/schema.ts` file without explicit instruction.

## System Architecture

### UI/UX Decisions
The platform features an Airbnb-inspired, modern premium design with generous spacing, soft shadows, and rounded corners. It incorporates a coastal travel theme with a color scheme of Turquoise Ocean (#0DA9A4) for primary actions, Coral Sunset (#FF8C5A) for CTAs, Sand (#F7F3EE) for backgrounds, and Dark Slate (#1F2A2E) for text. Typography uses Poppins for headings and Inter for body text. Shadcn UI components are styled to match the coastal theme, and smooth hover effects with animations are used throughout. The design is fully responsive, adapting layouts for mobile, tablet, and desktop views, including a mobile dropdown menu.

### Technical Implementations
The frontend is built with React and TypeScript, utilizing Tailwind CSS for styling and Shadcn UI for components. Wouter handles routing, TanStack Query manages data fetching, and React Hook Form with Zod validation ensures robust form handling. The backend is an Express.js API, with PostgreSQL (Neon) as the database, managed by Drizzle ORM. TypeScript is used across the stack for type safety, and shared schema definitions ensure consistency between frontend and backend.

**Authentication & Authorization**: Replit Auth integration using OpenID Connect (OIDC) protocol provides secure authentication with support for multiple providers (Google, GitHub, X, Apple, email/password). Sessions are persisted in PostgreSQL using connect-pg-simple with a 1-week TTL. 

**Role-Based Access Control**: Users have a `role` column (enum: 'admin' | 'customer', defaults to 'customer'). Admin routes are protected by `requireAdmin` middleware which verifies BOTH authentication AND admin role from the database. Regular users attempting admin access receive a 403 "Access Denied" response.

**Separate Login Flows**: 
- Regular users: `/api/login` → `/api/callback` → `/` (role: customer)
- Admins (secret link): `/admin/auth/login` → `/admin/auth/callback` → `/admin/dashboard` (role: admin, verified on callback)

The frontend `useAuth` hook manages authentication state, and the header component displays login/logout buttons based on user status.

### Feature Specifications
- **Customer-Facing**:
    - **Luxury Accommodations**: Detailed listings with high-quality imagery.
    - **Curated Services**: Add-on options including car rentals (self-driven/chauffeur), personal chefs, and errand services.
    - **Flexible Booking**: Accommodations with services, or standalone service bookings.
    - **Booking Management**: User dashboard to manage all reservations.
    - **Public Blog**: Travel tips and destination guides.
- **Admin Features** (Protected by Replit Auth):
    - **Secure Authentication**: Login with email/password or OAuth providers (Google, GitHub, X, Apple)
    - **Admin Dashboard**: Analytics overview with metrics (total bookings, revenue) and recent bookings
    - **Bookings Management**: CRUD operations, status filtering, and quick updates
    - **Listings Management**: Full CRUD for all service categories (stays, cars, cooks, errands)
    - **Blog Management**: Create, edit, and delete blog posts with a markdown editor, draft/published workflow, and auto-publish logic

### System Design Choices
- **API Structure**: 
  - Public routes: `/api/listings` with optional `?category=` filter for frontend display
  - Admin routes: All `/api/admin/*` endpoints protected by `requireAdmin` middleware
  - CRUD operations for accommodations, services, bookings, blog posts, and listings
- **Authentication & Authorization**: 
  - All `/api/admin/*` routes protected by `requireAdmin` middleware (checks authentication + admin role)
  - Regular users get role='customer', admins get role='admin' in database
  - Admin login via secret URL `/admin/auth/login` with role verification on callback
- **Data Models**: Comprehensive models for Users (with role column), Sessions, Accommodations, Services, Providers, Bookings, BlogPosts, and Listings. Listings use UUIDs for primary keys and store category-specific metadata in JSONB `features` column
- **Listings System**: 
  - Single unified `listings` table for all service categories (stays, cars, cooks, errands)
  - Frontend pages fetch filtered data via `/api/listings?category=X`
  - Features stored as JSON for flexible category-specific attributes
- **Service Types**: Diverse offerings including luxury accommodations, car rentals (self-drive/chauffeur), personal chef services, and errand services
- **Navigation**: Lifestyle-focused main navigation (Stay, Drive, Dine, Relax) alongside standard Home, Blog, and My Bookings
- **Development Standards**: PostgreSQL for persistent data storage, strong TypeScript typing, and Zod for validation
- **Sample Data**: Platform includes 16 sample listings (4 stays, 4 cars, 4 cooks, 4 errands), 3 published blog posts, and 1 test admin user

## External Dependencies
- **PostgreSQL Database**: Provided by Neon for persistent data storage
- **Drizzle ORM**: Used for database interactions and schema management
- **Replit Auth**: OpenID Connect authentication with OAuth provider support
- **connect-pg-simple**: PostgreSQL session store for Express sessions
- **openid-client**: OIDC client library for authentication flows
- **React**: Frontend library
- **Express.js**: Backend framework with session management
- **Tailwind CSS**: Utility-first CSS framework
- **Shadcn UI**: UI component library
- **Wouter**: Small routing library for React
- **TanStack Query**: Data fetching and state management
- **React Hook Form**: Form management with validation
- **Zod**: Schema validation library
- **react-markdown** and **remark-gfm**: For markdown rendering in blog posts

## Recent Changes (November 8, 2025)

### Phase 1: Initial Authentication
- **Authentication System**: Implemented Replit Auth integration with OIDC support for Google, GitHub, X, Apple, and email/password login
- **Session Management**: Configured PostgreSQL-backed sessions with 1-week TTL using connect-pg-simple
- **Database Migration**: Created `users` and `sessions` tables in PostgreSQL
- **Sample Data**: Populated database with 16 service listings across all categories and 3 published blog posts

### Phase 2: Role-Based Access Control & Listings Integration
- **Role-Based Authorization**: 
  - Added `role` column to users table (enum: 'admin' | 'customer', defaults to 'customer')
  - Implemented `requireAdmin` middleware that verifies authentication AND admin role
  - Created separate admin login flow via secret URL `/admin/auth/login`
  - Admin callback verifies role and blocks non-admin users with 403 response
  - All `/api/admin/*` routes now protected by `requireAdmin` instead of basic `isAuthenticated`

- **Public Listings API**:
  - Created `/api/listings` endpoint with optional `?category=` query parameter
  - Migrated all service pages (Stay, Drive, Dine, Relax) to use listings API with category filtering
  - Frontend pages query `/api/listings?category=X` for filtered data display
  - Listings display with images, features, pricing, and location data

- **Test User Setup**:
  - Created test admin user (id: test-admin-001, email: admin@tembea.test, role: admin)
  - Regular users default to customer role on first login

### Phase 3: Complete Booking Flow with Addon Selection
- **Fixed 404 Errors**: Migrated AccommodationDetail and Booking pages from deprecated `/api/accommodations` and `/api/services` endpoints to unified `/api/listings` API

- **Accommodation Detail Page**:
  - Updated to fetch from `/api/listings/:id` using Listing type
  - Adjusted UI to display Listing fields (price, features)

- **Booking Flow Implementation**:
  - Completely refactored booking page to use Listing type throughout
  - Fetches accommodation from `/api/listings/:id`
  - Fetches addon services from `/api/listings?category=(cars|cooks|errands)` in parallel
  - Implemented addon selection UI with checkboxes, category icons, and service cards
  - Added form validation with z.coerce.number() for guest count
  - Added date range validation (check-out after check-in)

- **Price Calculation System**:
  - Accommodation total = listing.price × nights
  - Addon totals = addon.price × nights (for each selected addon)
  - Total price = accommodation total + sum of all selected addons
  - All calculations memoized using useMemo to prevent infinite render loops

- **Critical Bug Fixes**:
  - Fixed infinite render loop by replacing `form.watch()` with `useWatch` and memoizing all price calculations
  - Fixed double-toggle bug by removing redundant onClick handler from parent div
  - Fixed NaN errors in guest count input with proper empty/invalid value handling

- **E2E Testing**: 
  - Verified complete booking flow end-to-end
  - Tested addon selection with multiple services
  - Confirmed no infinite render loops during form interaction
  - Validated price calculations update correctly
  - Verified booking submission (POST /api/bookings returns 201)
  - Confirmed success toast and redirect to /bookings page