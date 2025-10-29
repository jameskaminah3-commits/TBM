import {
  type Accommodation,
  type InsertAccommodation,
  type Service,
  type InsertService,
  type Provider,
  type InsertProvider,
  type Booking,
  type InsertBooking,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Accommodations
  getAccommodations(): Promise<Accommodation[]>;
  getAccommodation(id: string): Promise<Accommodation | undefined>;
  createAccommodation(accommodation: InsertAccommodation): Promise<Accommodation>;

  // Services
  getServices(): Promise<Service[]>;
  getService(id: string): Promise<Service | undefined>;
  createService(service: InsertService): Promise<Service>;

  // Providers
  getProviders(): Promise<Provider[]>;
  getProvider(id: string): Promise<Provider | undefined>;
  getProvidersByServiceType(serviceType: string): Promise<Provider[]>;
  createProvider(provider: InsertProvider): Promise<Provider>;

  // Bookings
  getBookings(): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking | undefined>;
  createBooking(booking: InsertBooking): Promise<Booking>;
}

export class MemStorage implements IStorage {
  private accommodations: Map<string, Accommodation>;
  private services: Map<string, Service>;
  private providers: Map<string, Provider>;
  private bookings: Map<string, Booking>;

  constructor() {
    this.accommodations = new Map();
    this.services = new Map();
    this.providers = new Map();
    this.bookings = new Map();
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
      {
        name: "Self-Drive Car Rental",
        type: "car-rental",
        description: "Premium vehicle rental with comprehensive insurance and 24/7 roadside assistance. Choose from luxury sedans, SUVs, and sports cars.",
        pricePerDay: 80,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Chauffeur_car_service_1e2a411b.png",
      },
      {
        name: "Chauffeur Service",
        type: "car-with-driver",
        description: "Professional chauffeur-driven service with luxury vehicles. Perfect for airport transfers, city tours, or special occasions.",
        pricePerDay: 250,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Chauffeur_car_service_1e2a411b.png",
      },
      {
        name: "Personal Chef Service",
        type: "personal-cook",
        description: "Experienced chef prepares gourmet meals in your accommodation. Custom menus tailored to your preferences and dietary requirements.",
        pricePerDay: 200,
        priceType: "per-day",
        imageUrl: "/attached_assets/generated_images/Personal_chef_service_2a86c242.png",
      },
      {
        name: "Grocery Shopping Service",
        type: "shopping",
        description: "Pre-arrival grocery shopping and fridge stocking. Arrive to a fully stocked kitchen with all your favorite items.",
        pricePerDay: 75,
        priceType: "one-time",
        imageUrl: null,
      },
      {
        name: "Premium Fridge Stocking",
        type: "fridge-stocking",
        description: "Curated selection of premium groceries, beverages, and essentials. Perfect for extended stays.",
        pricePerDay: 150,
        priceType: "one-time",
        imageUrl: null,
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

  // Services
  async getServices(): Promise<Service[]> {
    return Array.from(this.services.values());
  }

  async getService(id: string): Promise<Service | undefined> {
    return this.services.get(id);
  }

  async createService(insertService: InsertService): Promise<Service> {
    const id = randomUUID();
    const service: Service = { ...insertService, id };
    this.services.set(id, service);
    return service;
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
    const provider: Provider = { ...insertProvider, id };
    this.providers.set(id, provider);
    return provider;
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
    const booking: Booking = { ...insertBooking, id, createdAt };
    this.bookings.set(id, booking);
    return booking;
  }
}

export const storage = new MemStorage();
