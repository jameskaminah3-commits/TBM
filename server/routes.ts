import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, requireAdmin } from "./replitAuth";
import {
  insertBookingSchema,
  serverBookingSchema,
  insertAccommodationSchema,
  insertServiceSchema,
  insertProviderSchema,
  insertBlogPostSchema,
  insertListingSchema,
  insertStaySchema,
  insertCarSchema,
  insertCookSchema,
  insertErrandSchema,
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Replit Auth Integration: Setup authentication
  await setupAuth(app);

  // Replit Auth Integration: Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Accommodations
  app.get("/api/accommodations", async (_req, res) => {
    try {
      const accommodations = await storage.getAccommodations();
      res.json(accommodations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch accommodations" });
    }
  });

  app.get("/api/accommodations/:id", async (req, res) => {
    try {
      const accommodation = await storage.getAccommodation(req.params.id);
      if (!accommodation) {
        return res.status(404).json({ error: "Accommodation not found" });
      }
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch accommodation" });
    }
  });

  // Services
  app.get("/api/services", async (_req, res) => {
    try {
      const services = await storage.getServices();
      res.json(services);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch services" });
    }
  });

  app.get("/api/services/:id", async (req, res) => {
    try {
      const service = await storage.getService(req.params.id);
      if (!service) {
        return res.status(404).json({ error: "Service not found" });
      }
      res.json(service);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch service" });
    }
  });

  // Providers
  app.get("/api/providers", async (req, res) => {
    try {
      const { serviceType } = req.query;
      
      if (serviceType && typeof serviceType === "string") {
        const providers = await storage.getProvidersByServiceType(serviceType);
        return res.json(providers);
      }
      
      const providers = await storage.getProviders();
      res.json(providers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch providers" });
    }
  });

  app.get("/api/providers/:id", async (req, res) => {
    try {
      const provider = await storage.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }
      res.json(provider);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch provider" });
    }
  });

  // Bookings
  app.get("/api/bookings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const bookings = await storage.getBookingsByUserId(userId);
      res.json(bookings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch bookings" });
    }
  });

  app.get("/api/bookings/:id", async (req, res) => {
    try {
      const booking = await storage.getBooking(req.params.id);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }
      res.json(booking);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch booking" });
    }
  });

  app.post("/api/bookings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const guestEmail = req.user.claims.email;
      
      // Validate that we have the required session data
      if (!guestEmail) {
        return res.status(400).json({ error: "User email not found in session" });
      }
      
      // Inject session data into the request body
      const bookingData = {
        ...req.body,
        userId,
        guestEmail,
      };
      
      // Validate with server-side schema that includes injected fields
      const validatedData = serverBookingSchema.parse(bookingData);
      const booking = await storage.createBooking(validatedData);
      res.status(201).json(booking);
    } catch (error) {
      console.error("[BOOKING] Error creating booking:", error);
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create booking" });
      }
    }
  });

  // Listings (Public) - Unified catalog for all services
  app.get("/api/listings", async (req, res) => {
    try {
      const { category } = req.query;
      const listings = await storage.getListings();
      
      // Filter by category if provided
      const filteredListings = category 
        ? listings.filter(l => l.category === category)
        : listings;
      
      res.json(filteredListings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch listings" });
    }
  });

  app.get("/api/listings/:id", async (req, res) => {
    try {
      const listing = await storage.getListing(req.params.id);
      if (!listing) {
        return res.status(404).json({ error: "Listing not found" });
      }
      res.json(listing);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch listing" });
    }
  });

  // Blog Posts (Public)
  app.get("/api/blog", async (_req, res) => {
    try {
      const posts = await storage.getPublishedBlogPosts();
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch blog posts" });
    }
  });

  app.get("/api/blog/:slug", async (req, res) => {
    try {
      const post = await storage.getBlogPostBySlug(req.params.slug);
      if (!post || post.status !== "published") {
        return res.status(404).json({ error: "Blog post not found" });
      }
      res.json(post);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch blog post" });
    }
  });

  // ===== ADMIN ROUTES ===== (Protected by Replit Auth)
  
  // Admin Dashboard Analytics
  app.get("/api/admin/dashboard", requireAdmin, async (_req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard metrics" });
    }
  });

  app.get("/api/admin/analytics/popular-services", requireAdmin, async (_req, res) => {
    try {
      const popularServices = await storage.getPopularServices();
      res.json(popularServices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch popular services" });
    }
  });

  app.get("/api/admin/analytics/revenue", requireAdmin, async (_req, res) => {
    try {
      const revenue = await storage.getRevenueByMonth();
      res.json(revenue);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch revenue data" });
    }
  });

  // Admin Accommodations Management
  app.post("/api/admin/accommodations", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertAccommodationSchema.parse(req.body);
      const accommodation = await storage.createAccommodation(validatedData);
      res.status(201).json(accommodation);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create accommodation" });
      }
    }
  });

  app.patch("/api/admin/accommodations/:id", requireAdmin, async (req, res) => {
    try {
      const accommodation = await storage.updateAccommodation(req.params.id, req.body);
      if (!accommodation) {
        return res.status(404).json({ error: "Accommodation not found" });
      }
      res.json(accommodation);
    } catch (error) {
      res.status(500).json({ error: "Failed to update accommodation" });
    }
  });

  app.delete("/api/admin/accommodations/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteAccommodation(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Accommodation not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete accommodation" });
    }
  });

  // Admin Services Management
  app.post("/api/admin/services", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertServiceSchema.parse(req.body);
      const service = await storage.createService(validatedData);
      res.status(201).json(service);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create service" });
      }
    }
  });

  app.patch("/api/admin/services/:id", requireAdmin, async (req, res) => {
    try {
      const service = await storage.updateService(req.params.id, req.body);
      if (!service) {
        return res.status(404).json({ error: "Service not found" });
      }
      res.json(service);
    } catch (error) {
      res.status(500).json({ error: "Failed to update service" });
    }
  });

  app.delete("/api/admin/services/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteService(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Service not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete service" });
    }
  });

  // Admin Bookings Management
  app.patch("/api/admin/bookings/:id", requireAdmin, async (req, res) => {
    try {
      const booking = await storage.updateBooking(req.params.id, req.body);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }
      res.json(booking);
    } catch (error) {
      res.status(500).json({ error: "Failed to update booking" });
    }
  });

  app.delete("/api/admin/bookings/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteBooking(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Booking not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete booking" });
    }
  });

  // Admin Blog Management
  app.get("/api/admin/blog", requireAdmin, async (_req, res) => {
    try {
      const posts = await storage.getBlogPosts();
      res.json(posts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch blog posts" });
    }
  });

  app.get("/api/admin/blog/:id", requireAdmin, async (req, res) => {
    try {
      const post = await storage.getBlogPost(req.params.id);
      if (!post) {
        return res.status(404).json({ error: "Blog post not found" });
      }
      res.json(post);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch blog post" });
    }
  });

  app.post("/api/admin/blog", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertBlogPostSchema.parse(req.body);
      const blogPost = await storage.createBlogPost(validatedData);
      res.status(201).json(blogPost);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create blog post" });
      }
    }
  });

  app.patch("/api/admin/blog/:id", requireAdmin, async (req, res) => {
    try {
      const blogPost = await storage.updateBlogPost(req.params.id, req.body);
      if (!blogPost) {
        return res.status(404).json({ error: "Blog post not found" });
      }
      res.json(blogPost);
    } catch (error) {
      res.status(500).json({ error: "Failed to update blog post" });
    }
  });

  app.delete("/api/admin/blog/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteBlogPost(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Blog post not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete blog post" });
    }
  });

  // Admin Listings Management
  app.get("/api/admin/listings", requireAdmin, async (_req, res) => {
    try {
      const listings = await storage.getListings();
      res.json(listings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch listings" });
    }
  });

  app.get("/api/admin/listings/:id", requireAdmin, async (req, res) => {
    try {
      const listing = await storage.getListing(req.params.id);
      if (!listing) {
        return res.status(404).json({ error: "Listing not found" });
      }
      res.json(listing);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch listing" });
    }
  });

  app.post("/api/admin/listings", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertListingSchema.parse(req.body);
      const listing = await storage.createListing(validatedData);
      res.status(201).json(listing);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to create listing" });
      }
    }
  });

  app.patch("/api/admin/listings/:id", requireAdmin, async (req, res) => {
    try {
      const listing = await storage.updateListing(req.params.id, req.body);
      if (!listing) {
        return res.status(404).json({ error: "Listing not found" });
      }
      res.json(listing);
    } catch (error) {
      res.status(500).json({ error: "Failed to update listing" });
    }
  });

  app.delete("/api/admin/listings/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteListing(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Listing not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete listing" });
    }
  });

  // ===== NEW SEPARATE SERVICE ROUTES =====
  
  // Stays - Admin Routes
  app.get("/api/admin/stays", requireAdmin, async (_req, res) => {
    try {
      const stays = await storage.getStays();
      res.json(stays);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stays" });
    }
  });

  app.get("/api/admin/stays/:id", requireAdmin, async (req, res) => {
    try {
      const stay = await storage.getStay(req.params.id);
      if (!stay) {
        return res.status(404).json({ error: "Stay not found" });
      }
      res.json(stay);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stay" });
    }
  });

  app.post("/api/admin/stays", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertStaySchema.parse(req.body);
      const stay = await storage.createStay(validatedData);
      res.status(201).json(stay);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to create stay:", error);
        res.status(500).json({ error: "Failed to create stay" });
      }
    }
  });

  app.patch("/api/admin/stays/:id", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertStaySchema.partial().parse(req.body);
      const stay = await storage.updateStay(req.params.id, validatedData);
      if (!stay) {
        return res.status(404).json({ error: "Stay not found" });
      }
      res.json(stay);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to update stay:", error);
        res.status(500).json({ error: "Failed to update stay" });
      }
    }
  });

  app.delete("/api/admin/stays/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteStay(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Stay not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete stay" });
    }
  });

  // Cars - Admin Routes
  app.get("/api/admin/cars", requireAdmin, async (_req, res) => {
    try {
      const cars = await storage.getCars();
      res.json(cars);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cars" });
    }
  });

  app.get("/api/admin/cars/:id", requireAdmin, async (req, res) => {
    try {
      const car = await storage.getCar(req.params.id);
      if (!car) {
        return res.status(404).json({ error: "Car not found" });
      }
      res.json(car);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch car" });
    }
  });

  app.post("/api/admin/cars", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertCarSchema.parse(req.body);
      const car = await storage.createCar(validatedData);
      res.status(201).json(car);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to create car:", error);
        res.status(500).json({ error: "Failed to create car" });
      }
    }
  });

  app.patch("/api/admin/cars/:id", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertCarSchema.partial().parse(req.body);
      const car = await storage.updateCar(req.params.id, validatedData);
      if (!car) {
        return res.status(404).json({ error: "Car not found" });
      }
      res.json(car);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to update car:", error);
        res.status(500).json({ error: "Failed to update car" });
      }
    }
  });

  app.delete("/api/admin/cars/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteCar(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Car not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete car" });
    }
  });

  // Cooks - Admin Routes
  app.get("/api/admin/cooks", requireAdmin, async (_req, res) => {
    try {
      const cooks = await storage.getCooks();
      res.json(cooks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cooks" });
    }
  });

  app.get("/api/admin/cooks/:id", requireAdmin, async (req, res) => {
    try {
      const cook = await storage.getCook(req.params.id);
      if (!cook) {
        return res.status(404).json({ error: "Cook not found" });
      }
      res.json(cook);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cook" });
    }
  });

  app.post("/api/admin/cooks", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertCookSchema.parse(req.body);
      const cook = await storage.createCook(validatedData);
      res.status(201).json(cook);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to create cook:", error);
        res.status(500).json({ error: "Failed to create cook" });
      }
    }
  });

  app.patch("/api/admin/cooks/:id", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertCookSchema.partial().parse(req.body);
      const cook = await storage.updateCook(req.params.id, validatedData);
      if (!cook) {
        return res.status(404).json({ error: "Cook not found" });
      }
      res.json(cook);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to update cook:", error);
        res.status(500).json({ error: "Failed to update cook" });
      }
    }
  });

  app.delete("/api/admin/cooks/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteCook(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Cook not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete cook" });
    }
  });

  // Errands - Admin Routes
  app.get("/api/admin/errands", requireAdmin, async (_req, res) => {
    try {
      const errands = await storage.getErrands();
      res.json(errands);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch errands" });
    }
  });

  app.get("/api/admin/errands/:id", requireAdmin, async (req, res) => {
    try {
      const errand = await storage.getErrand(req.params.id);
      if (!errand) {
        return res.status(404).json({ error: "Errand not found" });
      }
      res.json(errand);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch errand" });
    }
  });

  app.post("/api/admin/errands", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertErrandSchema.parse(req.body);
      const errand = await storage.createErrand(validatedData);
      res.status(201).json(errand);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to create errand:", error);
        res.status(500).json({ error: "Failed to create errand" });
      }
    }
  });

  app.patch("/api/admin/errands/:id", requireAdmin, async (req, res) => {
    try {
      const validatedData = insertErrandSchema.partial().parse(req.body);
      const errand = await storage.updateErrand(req.params.id, validatedData);
      if (!errand) {
        return res.status(404).json({ error: "Errand not found" });
      }
      res.json(errand);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ error: error.message });
      } else {
        console.error("Failed to update errand:", error);
        res.status(500).json({ error: "Failed to update errand" });
      }
    }
  });

  app.delete("/api/admin/errands/:id", requireAdmin, async (req, res) => {
    try {
      const success = await storage.deleteErrand(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Errand not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete errand" });
    }
  });

  // Public Routes for fetching services
  app.get("/api/stays", async (_req, res) => {
    try {
      const stays = await storage.getStays();
      res.json(stays);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stays" });
    }
  });

  app.get("/api/stays/:id", async (req, res) => {
    try {
      const stay = await storage.getStay(req.params.id);
      if (!stay) {
        return res.status(404).json({ error: "Stay not found" });
      }
      res.json(stay);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stay" });
    }
  });

  app.get("/api/cars", async (_req, res) => {
    try {
      const cars = await storage.getCars();
      res.json(cars);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cars" });
    }
  });

  app.get("/api/cooks", async (_req, res) => {
    try {
      const cooks = await storage.getCooks();
      res.json(cooks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cooks" });
    }
  });

  app.get("/api/errands", async (_req, res) => {
    try {
      const errands = await storage.getErrands();
      res.json(errands);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch errands" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
