# Tembea Bila Matata - Lifestyle Concierge Platform

## Overview
Tembea Bila Matata is a premium lifestyle concierge platform that integrates luxury accommodation bookings with essential local services. Its purpose is to provide a single platform for guests to access vetted service providers, simplifying travel and local experiences. The platform aims to enable users to "Travel Local. Stay Easy. Live Bila Matata." by streamlining bookings for accommodations, car rentals, personal chefs, and errand services, effectively bridging the gap between convenient booking and hotel-style concierge service.

## User Preferences
I prefer simple language and detailed explanations. I want iterative development with frequent check-ins. Ask before making major changes to the codebase. Do not make changes to the `shared/schema.ts` file without explicit instruction.

## System Architecture

### UI/UX Decisions
The platform features an Airbnb-inspired, modern premium design with generous spacing, soft shadows, rounded corners, and a coastal travel theme. The color scheme includes Turquoise Ocean (#0DA9A4) for primary actions, Coral Sunset (#FF8C5A) for CTAs, Sand (#F7F3EE) for backgrounds, and Dark Slate (#1F2A2E) for text. Typography uses Poppins for headings and Inter for body text. Shadcn UI components are styled to match the theme, incorporating smooth hover effects and animations. The design is fully responsive across mobile, tablet, and desktop, including a mobile dropdown menu.

### Technical Implementations
The frontend is built with React and TypeScript, using Tailwind CSS for styling and Shadcn UI for components. Wouter handles routing, TanStack Query manages data fetching, and React Hook Form with Zod provides robust form validation. The backend is an Express.js API, with PostgreSQL (Neon) as the database, managed by Drizzle ORM. TypeScript is used throughout for type safety, with shared schema definitions ensuring consistency.

**Authentication & Authorization**: Replit Auth, utilizing OpenID Connect (OIDC), provides secure authentication with support for multiple providers (Google, GitHub, X, Apple, email/password). Sessions are persisted in PostgreSQL using `connect-pg-simple` with a 1-week TTL. Role-Based Access Control (RBAC) is implemented with a `role` column ('admin' | 'customer'), defaulting to 'customer'. Admin routes are protected by `requireAdmin` middleware, verifying both authentication and admin role. Separate login flows exist for regular users (`/auth`) and admins (`/admin/auth/login`). Admin access uses an email allowlist (`ADMIN_EMAILS` in server/replitAuth.ts) for fallback access; allowlisted users are auto-promoted to admin role during login callback, ensuring reliable admin access without manual database updates.

### Feature Specifications
- **Customer-Facing**: Luxury accommodations with detailed listings, curated add-on services (car rentals, personal chefs, errand services), flexible booking for accommodations and standalone services, a user dashboard for managing reservations, and a public blog for travel tips.
- **Admin Features**: Secure authentication, an Admin Dashboard with analytics, comprehensive CRUD operations for bookings and all service categories (stays, cars, cooks, errands), and blog management including a markdown editor, draft/published workflow, and auto-publish logic.

### System Design Choices
- **API Structure**: Public routes (`/api/stays`, `/api/cars`, etc.) provide type-safe data fetching for specific service domains. Admin routes (`/api/admin/*`) are protected by `requireAdmin` middleware and offer domain-specific CRUD operations for listings, bookings, and blog posts. Individual item fetch endpoints (`GET /api/admin/{entity}/:id`) enable edit form data loading with 404/500 error handling. `GET /api/bookings` is authenticated and filters by userId to ensure users only see their own bookings.
- **Data Models**: Separate domain tables (`Stays`, `Cars`, `Cooks`, `Errands`) with service-specific fields ensure accurate data representation. Shared models include `Users` (with role), `Sessions`, `Bookings` (with userId for user-specific filtering and guestPhone for contact info), and `BlogPosts`.
- **Admin Interface**: Features a tabbed listings page with category-specific tables and 8 separate domain-specific create/edit forms with Zod validation. A dropdown menu for "Add Listing" simplifies navigation to new item creation forms.
- **Development Standards**: Utilizes PostgreSQL for persistent data, strong TypeScript typing, and Zod for validation.
- **Service Types**: Diverse offerings including luxury accommodations, car rentals (self-drive/chauffeur), personal chef services, and errand services.
- **Navigation**: Lifestyle-focused main navigation (Stay, Drive, Dine, Relax) alongside standard Home, Blog, and My Bookings.
- **Data Integrity**: Real-time cache invalidation ensures admin CRUD changes immediately reflect on the frontend. User-specific booking filtering ensures data privacy.
- **Booking System**: Bookings are linked to authenticated users via `userId` field. POST /api/bookings captures userId from session. Users can only view their own bookings. Phone numbers are stored in `guestPhone` field for communication.
- **Pending Features**: Email confirmations for bookings (SendGrid/EmailJS integration deferred - user dismissed setup modal). Note: To implement later, ask user for SendGrid or EmailJS API keys and store as secrets.

## External Dependencies
- **PostgreSQL Database**: Neon
- **Drizzle ORM**: Database interactions and schema management
- **Replit Auth**: OpenID Connect authentication
- **connect-pg-simple**: PostgreSQL session store
- **openid-client**: OIDC client library
- **React**: Frontend library
- **Express.js**: Backend framework
- **Tailwind CSS**: Styling
- **Shadcn UI**: UI component library
- **Wouter**: Routing
- **TanStack Query**: Data fetching and state management
- **React Hook Form**: Form management
- **Zod**: Schema validation
- **react-markdown** and **remark-gfm**: Markdown rendering