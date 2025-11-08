import {
  type Accommodation,
  type InsertAccommodation,
  type Service,
  type InsertService,
  type Provider,
  type InsertProvider,
  type Booking,
  type InsertBooking,
  type BlogPost,
  type InsertBlogPost,
  type Listing,
  type InsertListing,
  type User,
  type UpsertUser,
  type DashboardMetrics,
  type PopularService,
  type RevenueByMonth,
  accommodations,
  services,
  providers,
  bookings,
  blogPosts,
  listings,
  users,
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  // Replit Auth Integration: User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Accommodations
  getAccommodations(): Promise<Accommodation[]>;
  getAccommodation(id: string): Promise<Accommodation | undefined>;
  createAccommodation(accommodation: InsertAccommodation): Promise<Accommodation>;
  updateAccommodation(id: string, accommodation: Partial<InsertAccommodation>): Promise<Accommodation | undefined>;
  deleteAccommodation(id: string): Promise<boolean>;

  // Services
  getServices(): Promise<Service[]>;
  getService(id: string): Promise<Service | undefined>;
  createService(service: InsertService): Promise<Service>;
  updateService(id: string, service: Partial<InsertService>): Promise<Service | undefined>;
  deleteService(id: string): Promise<boolean>;

  // Providers
  getProviders(): Promise<Provider[]>;
  getProvider(id: string): Promise<Provider | undefined>;
  getProvidersByServiceType(serviceType: string): Promise<Provider[]>;
  createProvider(provider: InsertProvider): Promise<Provider>;
  updateProvider(id: string, provider: Partial<InsertProvider>): Promise<Provider | undefined>;
  deleteProvider(id: string): Promise<boolean>;

  // Bookings
  getBookings(): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking | undefined>;
  createBooking(booking: InsertBooking): Promise<Booking>;
  updateBooking(id: string, booking: Partial<InsertBooking>): Promise<Booking | undefined>;
  deleteBooking(id: string): Promise<boolean>;

  // Blog Posts
  getBlogPosts(): Promise<BlogPost[]>;
  getPublishedBlogPosts(): Promise<BlogPost[]>;
  getBlogPost(id: string): Promise<BlogPost | undefined>;
  getBlogPostBySlug(slug: string): Promise<BlogPost | undefined>;
  createBlogPost(blogPost: InsertBlogPost): Promise<BlogPost>;
  updateBlogPost(id: string, blogPost: Partial<InsertBlogPost>): Promise<BlogPost | undefined>;
  deleteBlogPost(id: string): Promise<boolean>;

  // Listings
  getListings(): Promise<Listing[]>;
  getListing(id: string): Promise<Listing | undefined>;
  createListing(listing: InsertListing): Promise<Listing>;
  updateListing(id: string, listing: Partial<InsertListing>): Promise<Listing | undefined>;
  deleteListing(id: string): Promise<boolean>;

  // Analytics
  getDashboardMetrics(): Promise<DashboardMetrics>;
  getPopularServices(): Promise<PopularService[]>;
  getRevenueByMonth(): Promise<RevenueByMonth[]>;
}

// Database Storage implementation using Drizzle ORM and PostgreSQL
export class DatabaseStorage implements IStorage {
  // Replit Auth Integration: User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Accommodations
  async getAccommodations(): Promise<Accommodation[]> {
    return await db.select().from(accommodations);
  }

  async getAccommodation(id: string): Promise<Accommodation | undefined> {
    const [accommodation] = await db.select().from(accommodations).where(eq(accommodations.id, id));
    return accommodation;
  }

  async createAccommodation(data: InsertAccommodation): Promise<Accommodation> {
    const [accommodation] = await db.insert(accommodations).values(data).returning();
    return accommodation;
  }

  async updateAccommodation(id: string, data: Partial<InsertAccommodation>): Promise<Accommodation | undefined> {
    const [accommodation] = await db.update(accommodations).set(data).where(eq(accommodations.id, id)).returning();
    return accommodation;
  }

  async deleteAccommodation(id: string): Promise<boolean> {
    const result = await db.delete(accommodations).where(eq(accommodations.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Services
  async getServices(): Promise<Service[]> {
    return await db.select().from(services);
  }

  async getService(id: string): Promise<Service | undefined> {
    const [service] = await db.select().from(services).where(eq(services.id, id));
    return service;
  }

  async createService(data: InsertService): Promise<Service> {
    const [service] = await db.insert(services).values(data).returning();
    return service;
  }

  async updateService(id: string, data: Partial<InsertService>): Promise<Service | undefined> {
    const [service] = await db.update(services).set(data).where(eq(services.id, id)).returning();
    return service;
  }

  async deleteService(id: string): Promise<boolean> {
    const result = await db.delete(services).where(eq(services.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Providers
  async getProviders(): Promise<Provider[]> {
    return await db.select().from(providers);
  }

  async getProvider(id: string): Promise<Provider | undefined> {
    const [provider] = await db.select().from(providers).where(eq(providers.id, id));
    return provider;
  }

  async getProvidersByServiceType(serviceType: string): Promise<Provider[]> {
    return await db.select().from(providers).where(eq(providers.serviceType, serviceType));
  }

  async createProvider(data: InsertProvider): Promise<Provider> {
    const [provider] = await db.insert(providers).values(data).returning();
    return provider;
  }

  async updateProvider(id: string, data: Partial<InsertProvider>): Promise<Provider | undefined> {
    const [provider] = await db.update(providers).set(data).where(eq(providers.id, id)).returning();
    return provider;
  }

  async deleteProvider(id: string): Promise<boolean> {
    const result = await db.delete(providers).where(eq(providers.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Bookings
  async getBookings(): Promise<Booking[]> {
    return await db.select().from(bookings);
  }

  async getBooking(id: string): Promise<Booking | undefined> {
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    return booking;
  }

  async createBooking(data: InsertBooking): Promise<Booking> {
    const now = new Date().toISOString();
    const [booking] = await db.insert(bookings).values({ ...data, createdAt: now }).returning();
    return booking;
  }

  async updateBooking(id: string, data: Partial<InsertBooking>): Promise<Booking | undefined> {
    const [booking] = await db.update(bookings).set(data).where(eq(bookings.id, id)).returning();
    return booking;
  }

  async deleteBooking(id: string): Promise<boolean> {
    const result = await db.delete(bookings).where(eq(bookings.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Blog Posts
  async getBlogPosts(): Promise<BlogPost[]> {
    return await db.select().from(blogPosts);
  }

  async getPublishedBlogPosts(): Promise<BlogPost[]> {
    return await db.select().from(blogPosts).where(eq(blogPosts.status, 'published'));
  }

  async getBlogPost(id: string): Promise<BlogPost | undefined> {
    const [blogPost] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
    return blogPost;
  }

  async getBlogPostBySlug(slug: string): Promise<BlogPost | undefined> {
    const [blogPost] = await db.select().from(blogPosts).where(eq(blogPosts.slug, slug));
    return blogPost;
  }

  async createBlogPost(data: InsertBlogPost): Promise<BlogPost> {
    const now = new Date().toISOString();
    let publishedAt = data.publishedAt;
    
    // Auto-set publishedAt if status is "published" and publishedAt is not provided
    if (data.status === 'published' && !publishedAt) {
      publishedAt = now;
    }

    const [blogPost] = await db.insert(blogPosts).values({
      ...data,
      publishedAt,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return blogPost;
  }

  async updateBlogPost(id: string, data: Partial<InsertBlogPost>): Promise<BlogPost | undefined> {
    const now = new Date().toISOString();
    
    // Auto-set publishedAt when changing status to "published" if not already set
    let updateData = { ...data, updatedAt: now };
    if (data.status === 'published' && !data.publishedAt) {
      const existing = await this.getBlogPost(id);
      if (existing && !existing.publishedAt) {
        updateData.publishedAt = now;
      }
    }

    const [blogPost] = await db.update(blogPosts).set(updateData).where(eq(blogPosts.id, id)).returning();
    return blogPost;
  }

  async deleteBlogPost(id: string): Promise<boolean> {
    const result = await db.delete(blogPosts).where(eq(blogPosts.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Listings
  async getListings(): Promise<Listing[]> {
    return await db.select().from(listings);
  }

  async getListing(id: string): Promise<Listing | undefined> {
    const [listing] = await db.select().from(listings).where(eq(listings.id, id));
    return listing;
  }

  async createListing(data: InsertListing): Promise<Listing> {
    const now = new Date().toISOString();
    const [listing] = await db.insert(listings).values({
      ...data,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return listing;
  }

  async updateListing(id: string, data: Partial<InsertListing>): Promise<Listing | undefined> {
    const now = new Date().toISOString();
    const [listing] = await db.update(listings).set({ ...data, updatedAt: now }).where(eq(listings.id, id)).returning();
    return listing;
  }

  async deleteListing(id: string): Promise<boolean> {
    const result = await db.delete(listings).where(eq(listings.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Analytics
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const allBookings = await this.getBookings();
    
    const totalBookings = allBookings.length;
    const activeBookings = allBookings.filter(b => b.status === 'upcoming' || b.status === 'in-progress').length;
    const totalRevenue = allBookings.reduce((sum, b) => sum + b.totalPrice, 0);
    const accommodationBookings = allBookings.filter(b => b.bookingType === 'accommodation').length;
    const serviceOnlyBookings = allBookings.filter(b => b.bookingType === 'service').length;
    const recentBookings = allBookings
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return {
      totalBookings,
      activeBookings,
      totalRevenue,
      accommodationBookings,
      serviceOnlyBookings,
      recentBookings,
    };
  }

  async getPopularServices(): Promise<PopularService[]> {
    const allBookings = await this.getBookings();
    const serviceCounts = new Map<string, number>();

    allBookings.forEach(booking => {
      booking.selectedServices.forEach(serviceId => {
        serviceCounts.set(serviceId, (serviceCounts.get(serviceId) || 0) + 1);
      });
    });

    const allServices = await this.getServices();
    const popularServices: PopularService[] = [];

    serviceCounts.forEach((count, serviceId) => {
      const service = allServices.find(s => s.id === serviceId);
      if (service) {
        popularServices.push({
          serviceId,
          serviceName: service.name,
          bookingCount: count,
        });
      }
    });

    return popularServices.sort((a, b) => b.bookingCount - a.bookingCount).slice(0, 5);
  }

  async getRevenueByMonth(): Promise<RevenueByMonth[]> {
    const allBookings = await this.getBookings();
    const monthlyData = new Map<string, { revenue: number; count: number }>();

    allBookings.forEach(booking => {
      const date = new Date(booking.createdAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      const existing = monthlyData.get(monthKey) || { revenue: 0, count: 0 };
      monthlyData.set(monthKey, {
        revenue: existing.revenue + booking.totalPrice,
        count: existing.count + 1,
      });
    });

    return Array.from(monthlyData.entries())
      .map(([month, data]) => ({
        month,
        revenue: data.revenue,
        bookingCount: data.count,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }
}

export const storage = new DatabaseStorage();
