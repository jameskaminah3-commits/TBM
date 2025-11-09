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
  type Stay,
  type InsertStay,
  type Car,
  type InsertCar,
  type Cook,
  type InsertCook,
  type Errand,
  type InsertErrand,
  type StayReservation,
  type InsertStayReservation,
  type User,
  type UpsertUser,
  type UserRole,
  type DashboardMetrics,
  type PopularService,
  type RevenueByMonth,
  accommodations,
  services,
  providers,
  bookings,
  blogPosts,
  listings,
  stays,
  cars,
  cooks,
  errands,
  stayReservations,
  users,
} from "@shared/schema";
import { db } from "./db";
import { eq, inArray } from "drizzle-orm";

export interface IStorage {
  // Replit Auth Integration: User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserRole(userId: string, role: UserRole): Promise<User>;

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
  getBookingsByUserId(userId: string): Promise<Booking[]>;
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

  // Listings (DEPRECATED - use stays, cars, cooks, errands instead)
  getListings(): Promise<Listing[]>;
  getListing(id: string): Promise<Listing | undefined>;
  createListing(listing: InsertListing): Promise<Listing>;
  updateListing(id: string, listing: Partial<InsertListing>): Promise<Listing | undefined>;
  deleteListing(id: string): Promise<boolean>;

  // Stays
  getStays(): Promise<Stay[]>;
  getStay(id: string): Promise<Stay | undefined>;
  createStay(stay: InsertStay): Promise<Stay>;
  updateStay(id: string, stay: Partial<InsertStay>): Promise<Stay | undefined>;
  deleteStay(id: string): Promise<boolean>;

  // Cars
  getCars(): Promise<Car[]>;
  getCar(id: string): Promise<Car | undefined>;
  createCar(car: InsertCar): Promise<Car>;
  updateCar(id: string, car: Partial<InsertCar>): Promise<Car | undefined>;
  deleteCar(id: string): Promise<boolean>;

  // Cooks
  getCooks(): Promise<Cook[]>;
  getCook(id: string): Promise<Cook | undefined>;
  createCook(cook: InsertCook): Promise<Cook>;
  updateCook(id: string, cook: Partial<InsertCook>): Promise<Cook | undefined>;
  deleteCook(id: string): Promise<boolean>;

  // Errands
  getErrands(): Promise<Errand[]>;
  getErrand(id: string): Promise<Errand | undefined>;
  createErrand(errand: InsertErrand): Promise<Errand>;
  updateErrand(id: string, errand: Partial<InsertErrand>): Promise<Errand | undefined>;
  deleteErrand(id: string): Promise<boolean>;

  // Stay Reservations (for availability tracking)
  getStayReservations(stayId: string): Promise<StayReservation[]>;
  createStayReservation(reservation: InsertStayReservation): Promise<StayReservation>;
  deleteStayReservation(id: string): Promise<boolean>;

  // Analytics
  getDashboardMetrics(): Promise<DashboardMetrics>;
  getPopularServices(): Promise<PopularService[]>;
  getRevenueByMonth(): Promise<RevenueByMonth[]>;

  // Admin Clients
  getClientsWithBookings(): Promise<import("@shared/schema").ClientWithBookings[]>;
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
    // Check if user exists by email first to handle OIDC scenarios where
    // the same email might be provided with different IDs
    if (userData.email) {
      const existingUserByEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, userData.email))
        .limit(1);
      
      if (existingUserByEmail.length > 0 && existingUserByEmail[0].id !== userData.id) {
        // Update existing user with the new ID and data
        const [updated] = await db
          .update(users)
          .set({
            ...userData,
            updatedAt: new Date(),
          })
          .where(eq(users.email, userData.email))
          .returning();
        return updated;
      }
    }
    
    // Normal upsert based on ID
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

  async updateUserRole(userId: string, role: UserRole): Promise<User> {
    const [updated] = await db
      .update(users)
      .set({ 
        role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    
    if (!updated) {
      throw new Error(`User not found: ${userId}`);
    }
    
    console.log(`Updated user ${userId} role to ${role}`);
    return updated;
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

  async getBookingsByUserId(userId: string): Promise<Booking[]> {
    return await db.select().from(bookings).where(eq(bookings.userId, userId));
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

  // Stays
  async getStays(): Promise<Stay[]> {
    return await db.select().from(stays);
  }

  async getStay(id: string): Promise<Stay | undefined> {
    const [stay] = await db.select().from(stays).where(eq(stays.id, id));
    return stay;
  }

  async createStay(data: InsertStay): Promise<Stay> {
    const now = new Date().toISOString();
    const [stay] = await db.insert(stays).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return stay;
  }

  async updateStay(id: string, data: Partial<InsertStay>): Promise<Stay | undefined> {
    const [stay] = await db.update(stays).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(stays.id, id)).returning();
    return stay;
  }

  async deleteStay(id: string): Promise<boolean> {
    const result = await db.delete(stays).where(eq(stays.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Cars
  async getCars(): Promise<Car[]> {
    return await db.select().from(cars);
  }

  async getCar(id: string): Promise<Car | undefined> {
    const [car] = await db.select().from(cars).where(eq(cars.id, id));
    return car;
  }

  async createCar(data: InsertCar): Promise<Car> {
    const now = new Date().toISOString();
    const [car] = await db.insert(cars).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return car;
  }

  async updateCar(id: string, data: Partial<InsertCar>): Promise<Car | undefined> {
    const [car] = await db.update(cars).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(cars.id, id)).returning();
    return car;
  }

  async deleteCar(id: string): Promise<boolean> {
    const result = await db.delete(cars).where(eq(cars.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Cooks
  async getCooks(): Promise<Cook[]> {
    return await db.select().from(cooks);
  }

  async getCook(id: string): Promise<Cook | undefined> {
    const [cook] = await db.select().from(cooks).where(eq(cooks.id, id));
    return cook;
  }

  async createCook(data: InsertCook): Promise<Cook> {
    const now = new Date().toISOString();
    const [cook] = await db.insert(cooks).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return cook;
  }

  async updateCook(id: string, data: Partial<InsertCook>): Promise<Cook | undefined> {
    const [cook] = await db.update(cooks).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(cooks.id, id)).returning();
    return cook;
  }

  async deleteCook(id: string): Promise<boolean> {
    const result = await db.delete(cooks).where(eq(cooks.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Errands
  async getErrands(): Promise<Errand[]> {
    return await db.select().from(errands);
  }

  async getErrand(id: string): Promise<Errand | undefined> {
    const [errand] = await db.select().from(errands).where(eq(errands.id, id));
    return errand;
  }

  async createErrand(data: InsertErrand): Promise<Errand> {
    const now = new Date().toISOString();
    const [errand] = await db.insert(errands).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return errand;
  }

  async updateErrand(id: string, data: Partial<InsertErrand>): Promise<Errand | undefined> {
    const [errand] = await db.update(errands).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(errands.id, id)).returning();
    return errand;
  }

  async deleteErrand(id: string): Promise<boolean> {
    const result = await db.delete(errands).where(eq(errands.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Stay Reservations
  async getStayReservations(stayId: string): Promise<StayReservation[]> {
    return await db.select().from(stayReservations).where(eq(stayReservations.stayId, stayId));
  }

  async createStayReservation(data: InsertStayReservation): Promise<StayReservation> {
    const now = new Date().toISOString();
    const [reservation] = await db.insert(stayReservations).values({ ...data, createdAt: now }).returning();
    return reservation;
  }

  async deleteStayReservation(id: string): Promise<boolean> {
    const result = await db.delete(stayReservations).where(eq(stayReservations.id, id));
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

  async getClientsWithBookings(): Promise<import("@shared/schema").ClientWithBookings[]> {
    const allBookings = await this.getBookings();
    
    const accommodationIds = allBookings.filter(b => b.accommodationId).map(b => b.accommodationId!);
    const selectedServiceIds = Array.from(new Set(allBookings.flatMap(b => b.selectedServices)));
    const userIds = allBookings.filter(b => b.userId).map(b => b.userId!);

    const [accommodationsList, servicesList, usersList] = await Promise.all([
      accommodationIds.length > 0 ? db.select().from(stays).where(inArray(stays.id, accommodationIds)) : Promise.resolve([]),
      selectedServiceIds.length > 0 ? db.select().from(services).where(inArray(services.id, selectedServiceIds)) : Promise.resolve([]),
      userIds.length > 0 ? db.select().from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
    ]);

    const accommodationsMap = new Map(accommodationsList.map(a => [a.id, a]));
    const servicesMap = new Map(servicesList.map(s => [s.id, s]));
    const usersMap = new Map(usersList.map(u => [u.id, u]));

    const bookingsWithServices: import("@shared/schema").BookingWithServices[] = allBookings.map(booking => {
      const serviceSummaries: import("@shared/schema").ServiceSummary[] = [];
      
      if (booking.accommodationId && accommodationsMap.has(booking.accommodationId)) {
        const stay = accommodationsMap.get(booking.accommodationId)!;
        serviceSummaries.push({ type: "accommodation", id: stay.id, title: stay.title });
      }
      
      booking.selectedServices.forEach(serviceId => {
        const service = servicesMap.get(serviceId);
        if (service) {
          const serviceType = service.type.includes("car") ? "car" as const 
            : service.type.includes("cook") ? "cook" as const
            : service.type.includes("shopping") || service.type.includes("stocking") ? "errand" as const
            : "errand" as const;
          
          serviceSummaries.push({ 
            type: serviceType, 
            id: service.id, 
            title: service.name 
          });
        }
      });

      const { selectedServices, ...bookingWithoutSelectedServices } = booking;
      return {
        ...bookingWithoutSelectedServices,
        services: serviceSummaries,
      };
    });

    const clientsMap = new Map<string, import("@shared/schema").ClientWithBookings>();

    bookingsWithServices.forEach(booking => {
      const groupKey = booking.userId || booking.guestEmail || "unknown";
      
      if (!clientsMap.has(groupKey)) {
        const user = booking.userId ? usersMap.get(booking.userId) : null;
        
        clientsMap.set(groupKey, {
          user: user ? {
            id: user.id,
            email: user.email || undefined,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
          } : null,
          contactEmail: user?.email || booking.guestEmail || "",
          contactName: user 
            ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Unknown"
            : booking.guestName || booking.guestEmail || "Guest",
          bookings: [],
        });
      }

      clientsMap.get(groupKey)!.bookings.push(booking);
    });

    return Array.from(clientsMap.values()).sort((a, b) => 
      a.contactName.localeCompare(b.contactName)
    );
  }
}

export const storage = new DatabaseStorage();
