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

### Feature Specifications
- **Customer-Facing**:
    - **Luxury Accommodations**: Detailed listings with high-quality imagery.
    - **Curated Services**: Add-on options including car rentals (self-driven/chauffeur), personal chefs, and errand services.
    - **Flexible Booking**: Accommodations with services, or standalone service bookings.
    - **Booking Management**: User dashboard to manage all reservations.
    - **Public Blog**: Travel tips and destination guides.
- **Admin Features**:
    - **Admin Dashboard**: Analytics overview with metrics (total bookings, revenue) and recent bookings.
    - **Bookings Management**: CRUD operations, status filtering, and quick updates.
    - **Listings Management**: Full CRUD for all service categories (stays, cars, cooks, errands).
    - **Blog Management**: Create, edit, and delete blog posts with a markdown editor, draft/published workflow, and auto-publish logic.

### System Design Choices
- **API Structure**: Clearly defined public and admin API routes for accommodations, services, bookings, and blog posts, supporting CRUD operations.
- **Data Models**: Comprehensive models for Accommodations, Services, Providers, Bookings, BlogPosts, and Listings, including specific fields for car rental details, booking types, and blog content metadata. UUIDs are used for primary keys in listings.
- **Service Types**: Diverse offerings including 6 car rental options, 3 personal chef services, and 4 shopping/errand services.
- **Navigation**: Lifestyle-focused main navigation (Stay, Drive, Dine, Relax) alongside standard Home, Blog, and My Bookings.
- **Development Standards**: Employs in-memory storage for MVP (will migrate to DB), strong TypeScript typing, and Zod for validation.

## External Dependencies
- **PostgreSQL Database**: Provided by Neon.
- **Drizzle ORM**: Used for database interactions.
- **React**: Frontend library.
- **Express.js**: Backend framework.
- **Tailwind CSS**: Utility-first CSS framework.
- **Shadcn UI**: UI component library.
- **Wouter**: Small routing library for React.
- **TanStack Query**: Data fetching and state management.
- **React Hook Form**: Form management with validation.
- **Zod**: Schema validation library.
- **react-markdown** and **remark-gfm**: For markdown rendering in blog posts.