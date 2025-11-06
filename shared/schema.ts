import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  accommodationId: varchar("accommodation_id"), // Optional - allows standalone service bookings
  guestName: text("guest_name").notNull(),
  guestEmail: text("guest_email").notNull(),
  checkIn: text("check_in").notNull(),
  checkOut: text("check_out").notNull(),
  guests: integer("guests").notNull(),
  selectedServices: text("selected_services").array().notNull(),
  totalPrice: integer("total_price").notNull(),
  status: text("status").notNull().default("upcoming"),
  createdAt: text("created_at").notNull(),
  bookingType: text("booking_type").notNull().default("accommodation"), // "accommodation" or "service"
});

export const insertBookingSchema = createInsertSchema(bookings).omit({
  id: true,
  createdAt: true,
});

export type InsertBooking = z.infer<typeof insertBookingSchema>;
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
