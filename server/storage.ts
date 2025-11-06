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
  type DashboardMetrics,
  type PopularService,
  type RevenueByMonth,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
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

  // Analytics
  getDashboardMetrics(): Promise<DashboardMetrics>;
  getPopularServices(): Promise<PopularService[]>;
  getRevenueByMonth(): Promise<RevenueByMonth[]>;
}

export class MemStorage implements IStorage {
  private accommodations: Map<string, Accommodation>;
  private services: Map<string, Service>;
  private providers: Map<string, Provider>;
  private bookings: Map<string, Booking>;
  private blogPosts: Map<string, BlogPost>;

  constructor() {
    this.accommodations = new Map();
    this.services = new Map();
    this.providers = new Map();
    this.bookings = new Map();
    this.blogPosts = new Map();
    this.seedData();
  }

  private seedData() {
    // Seed accommodations
    const accommodationData = [
      {
        title: "Beachfront Paradise Villa",
        location: "Malibu, California",
        description: "Experience ultimate luxury in this stunning beachfront villa featuring panoramic ocean views, infinity pool, and direct beach access. Modern architecture meets coastal elegance with floor-to-ceiling windows, designer furnishings, and premium amenities throughout.",
        pricePerNight: 850,
        maxGuests: 8,
        bedrooms: 4,
        bathrooms: 4,
        imageUrl: "/attached_assets/generated_images/Luxury_beachfront_villa_hero_b917e1ae.png",
        rating: 48, // Stored as integer (4.8 * 10) for consistency
        reviewCount: 127,
        amenities: ["Ocean View", "Infinity Pool", "Beach Access", "WiFi", "Air Conditioning", "Full Kitchen", "Parking"],
      },
      {
        title: "Mountain Retreat Cabin",
        location: "Aspen, Colorado",
        description: "Nestled in the mountains, this luxury cabin offers the perfect blend of rustic charm and modern comfort. Featuring exposed wooden beams, stone fireplace, and breathtaking mountain views from every window.",
        pricePerNight: 675,
        maxGuests: 6,
        bedrooms: 3,
        bathrooms: 3,
        imageUrl: "/attached_assets/generated_images/Mountain_cabin_accommodation_49b66a1c.png",
        rating: 47, // Stored as integer (4.7 * 10)
        reviewCount: 94,
        amenities: ["Mountain View", "Fireplace", "Hot Tub", "WiFi", "Heating", "Full Kitchen", "Ski Storage"],
      },
      {
        title: "Downtown Luxury Penthouse",
        location: "Manhattan, New York",
        description: "Sophisticated penthouse in the heart of Manhattan with stunning city skyline views. Contemporary design, state-of-the-art amenities, and walking distance to world-class dining and entertainment.",
        pricePerNight: 950,
        maxGuests: 4,
        bedrooms: 2,
        bathrooms: 2,
        imageUrl: "/attached_assets/generated_images/City_penthouse_accommodation_12c167e3.png",
        rating: 49, // Stored as integer (4.9 * 10)
        reviewCount: 156,
        amenities: ["City View", "Rooftop Access", "Gym", "WiFi", "Air Conditioning", "Full Kitchen", "Concierge"],
      },
      {
        title: "Mediterranean Coastal Villa",
        location: "Santorini, Greece",
        description: "Charming villa perched on the cliffs with breathtaking Aegean Sea views. Traditional architecture with modern comforts, featuring a private terrace perfect for sunset watching and al fresco dining.",
        pricePerNight: 725,
        maxGuests: 6,
        bedrooms: 3,
        bathrooms: 2,
        imageUrl: "/attached_assets/generated_images/Mediterranean_villa_accommodation_649da59e.png",
        rating: 50, // Stored as integer (5.0 * 10)
        reviewCount: 203,
        amenities: ["Sea View", "Private Terrace", "Pool", "WiFi", "Air Conditioning", "Full Kitchen", "BBQ Area"],
      },
    ];

    accommodationData.forEach((data) => {
      const id = randomUUID();
      this.accommodations.set(id, { ...data, id });
    });

    // Seed services
    const serviceData = [
      // Car Rental - Variety of Options
      {
        name: "Compact Sedan - Self Drive",
        type: "car-rental",
        description: "Fuel-efficient compact sedan perfect for city driving. Includes GPS, insurance, and 24/7 roadside assistance.",
        pricePerDay: 50,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Chauffeur_car_service_1e2a411b.png",
        deliveryType: "self-driven",
        vehicleType: "sedan",
        transmission: "automatic",
        seatingCapacity: 5,
      },
      {
        name: "Luxury SUV - Self Drive",
        type: "car-rental",
        description: "Premium SUV with ample space and advanced features. Ideal for families or groups exploring in comfort.",
        pricePerDay: 120,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Chauffeur_car_service_1e2a411b.png",
        deliveryType: "self-driven",
        vehicleType: "suv",
        transmission: "automatic",
        seatingCapacity: 7,
      },
      {
        name: "Sports Car - Self Drive",
        type: "car-rental",
        description: "High-performance sports car for an exhilarating driving experience. Premium insurance included.",
        pricePerDay: 200,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Chauffeur_car_service_1e2a411b.png",
        deliveryType: "self-driven",
        vehicleType: "luxury",
        transmission: "automatic",
        seatingCapacity: 2,
      },
      {
        name: "Luxury Sedan - Chauffeur Driven",
        type: "car-rental",
        description: "Professional chauffeur service in a luxury sedan. Perfect for business meetings and airport transfers.",
        pricePerDay: 250,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Chauffeur_car_service_1e2a411b.png",
        deliveryType: "chauffeur",
        vehicleType: "luxury",
        transmission: "automatic",
        seatingCapacity: 4,
      },
      {
        name: "Executive Van - Chauffeur Driven",
        type: "car-rental",
        description: "Spacious executive van with professional driver. Ideal for group tours and family outings.",
        pricePerDay: 300,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Chauffeur_car_service_1e2a411b.png",
        deliveryType: "chauffeur",
        vehicleType: "van",
        transmission: "automatic",
        seatingCapacity: 8,
      },
      {
        name: "Budget Sedan - Manual",
        type: "car-rental",
        description: "Affordable manual transmission sedan for budget-conscious travelers. Reliable and economical.",
        pricePerDay: 35,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Chauffeur_car_service_1e2a411b.png",
        deliveryType: "self-driven",
        vehicleType: "sedan",
        transmission: "manual",
        seatingCapacity: 5,
      },
      // Personal Chef Services
      {
        name: "Personal Chef Service",
        type: "personal-cook",
        description: "Experienced chef prepares gourmet meals in your accommodation. Custom menus tailored to your preferences and dietary requirements.",
        pricePerDay: 200,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Personal_chef_service_2a86c242.png",
        deliveryType: null,
        vehicleType: null,
        transmission: null,
        seatingCapacity: null,
      },
      {
        name: "Breakfast Chef Service",
        type: "personal-cook",
        description: "Start your day right with a personal chef preparing fresh, healthy breakfasts every morning.",
        pricePerDay: 80,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Personal_chef_service_2a86c242.png",
        deliveryType: null,
        vehicleType: null,
        transmission: null,
        seatingCapacity: null,
      },
      {
        name: "Special Occasion Chef",
        type: "personal-cook",
        description: "Expert chef for special events and celebrations. Multi-course meals with wine pairing recommendations.",
        pricePerDay: 500,
        priceType: "one-time",
        imageUrl: "/attached_assets/generated_images/Personal_chef_service_2a86c242.png",
        deliveryType: null,
        vehicleType: null,
        transmission: null,
        seatingCapacity: null,
      },
      // Errand and Shopping Services
      {
        name: "Grocery Shopping Service",
        type: "shopping",
        description: "Pre-arrival grocery shopping and fridge stocking. Arrive to a fully stocked kitchen with all your favorite items.",
        pricePerDay: 75,
        priceType: "one-time",
        imageUrl: null,
        deliveryType: null,
        vehicleType: null,
        transmission: null,
        seatingCapacity: null,
      },
      {
        name: "Premium Fridge Stocking",
        type: "fridge-stocking",
        description: "Curated selection of premium groceries, beverages, and essentials. Perfect for extended stays.",
        pricePerDay: 150,
        priceType: "one-time",
        imageUrl: null,
        deliveryType: null,
        vehicleType: null,
        transmission: null,
        seatingCapacity: null,
      },
      {
        name: "Personal Shopping Assistant",
        type: "shopping",
        description: "Personal shopper for clothing, gifts, or specialty items. Includes delivery to your accommodation.",
        pricePerDay: 100,
        priceType: "one-time",
        imageUrl: null,
        deliveryType: null,
        vehicleType: null,
        transmission: null,
        seatingCapacity: null,
      },
      {
        name: "Laundry & Dry Cleaning",
        type: "shopping",
        description: "Professional laundry and dry cleaning pickup and delivery service.",
        pricePerDay: 50,
        priceType: "one-time",
        imageUrl: null,
        deliveryType: null,
        vehicleType: null,
        transmission: null,
        seatingCapacity: null,
      },
    ];

    serviceData.forEach((data) => {
      const id = randomUUID();
      this.services.set(id, { ...data, id });
    });

    // Seed providers
    const providerData = [
      {
        name: "Elite Car Rentals",
        serviceType: "car-rental",
        rating: 48, // Stored as integer (4.8 * 10)
        reviewCount: 342,
        experience: 8,
        bio: "Premium car rental service specializing in luxury and exotic vehicles with white-glove service.",
        imageUrl: null,
        verified: true,
        slaResponseTime: "2 hours",
      },
      {
        name: "Chef Marcus Anderson",
        serviceType: "personal-cook",
        rating: 50, // Stored as integer (5.0 * 10)
        reviewCount: 128,
        experience: 15,
        bio: "Award-winning chef with Michelin-star experience. Specializes in farm-to-table and international cuisine.",
        imageUrl: null,
        verified: true,
        slaResponseTime: "24 hours",
      },
      {
        name: "Prestige Chauffeur Service",
        serviceType: "car-with-driver",
        rating: 49, // Stored as integer (4.9 * 10)
        reviewCount: 456,
        experience: 12,
        bio: "Professional chauffeur service with certified drivers and luxury fleet. Background-checked and insured.",
        imageUrl: null,
        verified: true,
        slaResponseTime: "1 hour",
      },
    ];

    providerData.forEach((data) => {
      const id = randomUUID();
      this.providers.set(id, { ...data, id });
    });
  }

  // Accommodations
  async getAccommodations(): Promise<Accommodation[]> {
    return Array.from(this.accommodations.values());
  }

  async getAccommodation(id: string): Promise<Accommodation | undefined> {
    return this.accommodations.get(id);
  }

  async createAccommodation(insertAccommodation: InsertAccommodation): Promise<Accommodation> {
    const id = randomUUID();
    const accommodation: Accommodation = { ...insertAccommodation, id };
    this.accommodations.set(id, accommodation);
    return accommodation;
  }

  async updateAccommodation(id: string, update: Partial<InsertAccommodation>): Promise<Accommodation | undefined> {
    const existing = this.accommodations.get(id);
    if (!existing) return undefined;
    const updated: Accommodation = { ...existing, ...update };
    this.accommodations.set(id, updated);
    return updated;
  }

  async deleteAccommodation(id: string): Promise<boolean> {
    return this.accommodations.delete(id);
  }

  // Services
  async getServices(): Promise<Service[]> {
    return Array.from(this.services.values());
  }

  async getService(id: string): Promise<Service | undefined> {
    return this.services.get(id);
  }

  async createService(insertService: InsertService): Promise<Service> {
    const id = randomUUID();
    const service: Service = { 
      ...insertService, 
      id,
      imageUrl: insertService.imageUrl ?? null,
      deliveryType: insertService.deliveryType ?? null,
      vehicleType: insertService.vehicleType ?? null,
      transmission: insertService.transmission ?? null,
      seatingCapacity: insertService.seatingCapacity ?? null,
    };
    this.services.set(id, service);
    return service;
  }

  async updateService(id: string, update: Partial<InsertService>): Promise<Service | undefined> {
    const existing = this.services.get(id);
    if (!existing) return undefined;
    const updated: Service = { ...existing, ...update };
    this.services.set(id, updated);
    return updated;
  }

  async deleteService(id: string): Promise<boolean> {
    return this.services.delete(id);
  }

  // Providers
  async getProviders(): Promise<Provider[]> {
    return Array.from(this.providers.values());
  }

  async getProvider(id: string): Promise<Provider | undefined> {
    return this.providers.get(id);
  }

  async getProvidersByServiceType(serviceType: string): Promise<Provider[]> {
    return Array.from(this.providers.values()).filter(
      (provider) => provider.serviceType === serviceType
    );
  }

  async createProvider(insertProvider: InsertProvider): Promise<Provider> {
    const id = randomUUID();
    const provider: Provider = { 
      ...insertProvider, 
      id,
      imageUrl: insertProvider.imageUrl ?? null,
      verified: insertProvider.verified ?? true,
    };
    this.providers.set(id, provider);
    return provider;
  }

  async updateProvider(id: string, update: Partial<InsertProvider>): Promise<Provider | undefined> {
    const existing = this.providers.get(id);
    if (!existing) return undefined;
    const updated: Provider = { ...existing, ...update };
    this.providers.set(id, updated);
    return updated;
  }

  async deleteProvider(id: string): Promise<boolean> {
    return this.providers.delete(id);
  }

  // Bookings
  async getBookings(): Promise<Booking[]> {
    return Array.from(this.bookings.values());
  }

  async getBooking(id: string): Promise<Booking | undefined> {
    return this.bookings.get(id);
  }

  async createBooking(insertBooking: InsertBooking): Promise<Booking> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const booking: Booking = { 
      ...insertBooking, 
      id, 
      createdAt,
      accommodationId: insertBooking.accommodationId ?? null,
      status: insertBooking.status ?? "upcoming",
      bookingType: insertBooking.bookingType ?? "accommodation",
    };
    this.bookings.set(id, booking);
    return booking;
  }

  async updateBooking(id: string, update: Partial<InsertBooking>): Promise<Booking | undefined> {
    const existing = this.bookings.get(id);
    if (!existing) return undefined;
    const updated: Booking = { ...existing, ...update };
    this.bookings.set(id, updated);
    return updated;
  }

  async deleteBooking(id: string): Promise<boolean> {
    return this.bookings.delete(id);
  }

  // Blog Posts
  async getBlogPosts(): Promise<BlogPost[]> {
    return Array.from(this.blogPosts.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getPublishedBlogPosts(): Promise<BlogPost[]> {
    return Array.from(this.blogPosts.values())
      .filter(post => post.status === "published" && post.publishedAt)
      .sort((a, b) => 
        new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime()
      );
  }

  async getBlogPost(id: string): Promise<BlogPost | undefined> {
    return this.blogPosts.get(id);
  }

  async getBlogPostBySlug(slug: string): Promise<BlogPost | undefined> {
    return Array.from(this.blogPosts.values()).find(post => post.slug === slug);
  }

  async createBlogPost(insertBlogPost: InsertBlogPost): Promise<BlogPost> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const blogPost: BlogPost = { 
      ...insertBlogPost, 
      id,
      createdAt: now,
      updatedAt: now,
      status: insertBlogPost.status ?? "draft",
      featuredImage: insertBlogPost.featuredImage ?? null,
      publishedAt: insertBlogPost.publishedAt ?? null,
    };
    this.blogPosts.set(id, blogPost);
    return blogPost;
  }

  async updateBlogPost(id: string, update: Partial<InsertBlogPost>): Promise<BlogPost | undefined> {
    const existing = this.blogPosts.get(id);
    if (!existing) return undefined;
    const updatedAt = new Date().toISOString();
    const updated: BlogPost = { ...existing, ...update, updatedAt };
    this.blogPosts.set(id, updated);
    return updated;
  }

  async deleteBlogPost(id: string): Promise<boolean> {
    return this.blogPosts.delete(id);
  }

  // Analytics
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const allBookings = Array.from(this.bookings.values());
    const totalBookings = allBookings.length;
    const activeBookings = allBookings.filter(b => b.status === "upcoming" || b.status === "in-progress").length;
    const totalRevenue = allBookings.reduce((sum, b) => sum + b.totalPrice, 0);
    const accommodationBookings = allBookings.filter(b => b.bookingType === "accommodation").length;
    const serviceOnlyBookings = allBookings.filter(b => b.bookingType === "service").length;
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
    const allBookings = Array.from(this.bookings.values());
    const serviceCounts = new Map<string, number>();

    allBookings.forEach(booking => {
      booking.selectedServices.forEach(serviceId => {
        serviceCounts.set(serviceId, (serviceCounts.get(serviceId) || 0) + 1);
      });
    });

    const popularServices: PopularService[] = [];
    for (const [serviceId, count] of Array.from(serviceCounts.entries())) {
      const service = this.services.get(serviceId);
      if (service) {
        popularServices.push({
          serviceId,
          serviceName: service.name,
          bookingCount: count,
        });
      }
    }

    return popularServices.sort((a, b) => b.bookingCount - a.bookingCount).slice(0, 5);
  }

  async getRevenueByMonth(): Promise<RevenueByMonth[]> {
    const allBookings = Array.from(this.bookings.values());
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

    const result: RevenueByMonth[] = [];
    for (const [month, data] of Array.from(monthlyData.entries())) {
      result.push({
        month,
        revenue: data.revenue,
        bookingCount: data.count,
      });
    }

    return result.sort((a, b) => a.month.localeCompare(b.month));
  }
}

export const storage = new MemStorage();
