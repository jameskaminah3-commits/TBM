import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Replit Auth Integration: Session storage table
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Replit Auth Integration: User storage table
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const userRoles = ["admin", "customer"] as const;
export type UserRole = typeof userRoles[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role").notNull().default("customer"), // admin or customer
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Accommodations
export const accommodations = pgTable("accommodations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  pricePerNight: integer("price_per_night").notNull(),
  maxGuests: integer("max_guests").notNull(),
  bedrooms: integer("bedrooms").notNull(),
  bathrooms: integer("bathrooms").notNull(),
  imageUrl: text("image_url").notNull(),
  rating: integer("rating").notNull(),
  reviewCount: integer("review_count").notNull(),
  amenities: text("amenities").array().notNull(),
});

export const insertAccommodationSchema = createInsertSchema(accommodations).omit({
  id: true,
});

export type InsertAccommodation = z.infer<typeof insertAccommodationSchema>;
export type Accommodation = typeof accommodations.$inferSelect;

// Service Types
export const serviceTypes = ["car-rental", "car-with-driver", "personal-cook", "shopping", "fridge-stocking"] as const;
export type ServiceType = typeof serviceTypes[number];

// Booking Status
export const bookingStatus = z.enum(["upcoming", "in-progress", "completed", "cancelled"]);
export type BookingStatus = z.infer<typeof bookingStatus>;

// Services
export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  pricePerDay: integer("price_per_day").notNull(),
  priceType: text("price_type").notNull(), // "per-day", "one-time", "per-hour"
  imageUrl: text("image_url"),
  // Car rental specific fields
  deliveryType: text("delivery_type"), // "self-driven", "chauffeur"
  vehicleType: text("vehicle_type"), // "sedan", "suv", "luxury", "van"
  transmission: text("transmission"), // "automatic", "manual"
  seatingCapacity: integer("seating_capacity"),
});

export const insertServiceSchema = createInsertSchema(services).omit({
  id: true,
});

export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof services.$inferSelect;

// Service Providers
export const providers = pgTable("providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  serviceType: text("service_type").notNull(),
  rating: integer("rating").notNull(),
  reviewCount: integer("review_count").notNull(),
  experience: integer("experience").notNull(),
  bio: text("bio").notNull(),
  imageUrl: text("image_url"),
  verified: boolean("verified").notNull().default(true),
  slaResponseTime: text("sla_response_time").notNull(),
});

export const insertProviderSchema = createInsertSchema(providers).omit({
  id: true,
});

export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providers.$inferSelect;

// Bookings
export const bookings = pgTable("bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"), // Links booking to authenticated user
  accommodationId: varchar("accommodation_id"), // Optional - allows standalone service bookings
  guestName: text("guest_name").notNull(),
  guestEmail: text("guest_email").notNull(),
  guestPhone: text("guest_phone"), // Contact phone number
  checkIn: text("check_in").notNull(),
  checkOut: text("check_out").notNull(),
  guests: integer("guests").notNull(),
  selectedServices: text("selected_services").array().notNull(),
  totalPrice: integer("total_price").notNull(),
  status: text("status").notNull().default("upcoming"),
  createdAt: text("created_at").notNull(),
  bookingType: text("booking_type").notNull().default("accommodation"), // "accommodation" or "service"
});

// Client-side booking schema - omits fields that backend injects from session
export const insertBookingSchema = createInsertSchema(bookings).omit({
  id: true,
  createdAt: true,
  userId: true, // Backend injects from session
  guestEmail: true, // Backend injects from session
}).extend({
  accommodationId: z.string().nullable(),
  guestPhone: z.string().optional(),
});

// Server-side schema for validation after injecting session data
export const serverBookingSchema = insertBookingSchema.extend({
  userId: z.string(),
  guestEmail: z.string().email(),
});

export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type ServerBooking = z.infer<typeof serverBookingSchema>;
export type Booking = typeof bookings.$inferSelect;

// Blog Posts
export const blogPosts = pgTable("blog_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  excerpt: text("excerpt").notNull(),
  contentMarkdown: text("content_markdown").notNull(),
  featuredImage: text("featured_image"),
  author: text("author").notNull(),
  publishedAt: text("published_at"),
  status: text("status").notNull().default("draft"), // "draft" or "published"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertBlogPostSchema = createInsertSchema(blogPosts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;
export type BlogPost = typeof blogPosts.$inferSelect;

// Listings (Admin-managed service listings) - DEPRECATED: Use separate tables below
export const listingCategories = ["stays", "cars", "cooks", "errands"] as const;
export type ListingCategory = typeof listingCategories[number];

export const listings = pgTable("listings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  category: text("category").notNull(), // "stays", "cars", "cooks", "errands"
  price: integer("price").notNull(),
  location: text("location").notNull(),
  imageUrl: text("image_url"),
  description: text("description").notNull(),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertListingSchema = createInsertSchema(listings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listings.$inferSelect;

// ===== NEW SEPARATE SERVICE TABLES =====

// Stays
export const stays = pgTable("stays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(), // price per night
  maxOccupancy: integer("max_occupancy").notNull(),
  bedrooms: integer("bedrooms").notNull(),
  bathrooms: integer("bathrooms").notNull(),
  imageUrl: text("image_url"),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertStaySchema = createInsertSchema(stays).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStay = z.infer<typeof insertStaySchema>;
export type Stay = typeof stays.$inferSelect;

// Stay Reservations (for availability tracking)
export const stayReservations = pgTable("stay_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stayId: varchar("stay_id").notNull(),
  startDate: text("start_date").notNull(), // ISO date string
  endDate: text("end_date").notNull(), // ISO date string
  status: text("status").notNull().default("booked"), // "booked" or "blocked"
  bookingId: varchar("booking_id"), // Optional reference to booking
  createdAt: text("created_at").notNull(),
});

export const insertStayReservationSchema = createInsertSchema(stayReservations).omit({
  id: true,
  createdAt: true,
});

export type InsertStayReservation = z.infer<typeof insertStayReservationSchema>;
export type StayReservation = typeof stayReservations.$inferSelect;

// Cars
export const cars = pgTable("cars", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  model: text("model").notNull(),
  pricePerDay: integer("price_per_day").notNull(),
  priceWithDriver: integer("price_with_driver"), // Optional - only if chauffeur available
  seats: integer("seats").notNull(),
  transmission: text("transmission").notNull(), // "automatic" or "manual"
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertCarSchema = createInsertSchema(cars).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCar = z.infer<typeof insertCarSchema>;
export type Car = typeof cars.$inferSelect;

// Cooks
export const cooks = pgTable("cooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(), // e.g., "Chef John Doe"
  speciality: text("speciality").notNull(), // e.g., "Italian Cuisine"
  pricePerSession: integer("price_per_session").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertCookSchema = createInsertSchema(cooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCook = z.infer<typeof insertCookSchema>;
export type Cook = typeof cooks.$inferSelect;

// Errands
export const errands = pgTable("errands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceName: text("service_name").notNull(), // e.g., "Grocery Shopping"
  basePrice: integer("base_price").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  features: text("features").array().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertErrandSchema = createInsertSchema(errands).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertErrand = z.infer<typeof insertErrandSchema>;
export type Errand = typeof errands.$inferSelect;

// Analytics Types
export type DashboardMetrics = {
  totalBookings: number;
  activeBookings: number;
  totalRevenue: number;
  accommodationBookings: number;
  serviceOnlyBookings: number;
  recentBookings: Booking[];
};

export type PopularService = {
  serviceId: string;
  serviceName: string;
  bookingCount: number;
};

export type RevenueByMonth = {
  month: string;
  revenue: number;
  bookingCount: number;
};
