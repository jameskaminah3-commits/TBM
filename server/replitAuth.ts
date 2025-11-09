// Replit Auth Integration
import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  // Admin login route - restricted to admins only
  app.get("/admin/auth/login", async (req: any, res, next) => {
    // If already authenticated, check if they're an admin
    if (req.isAuthenticated() && req.user?.claims?.sub) {
      try {
        const userId = req.user.claims.sub;
        const userEmail = req.user.claims.email;
        const dbUser = await storage.getUser(userId);
        
        const isAdminRole = dbUser && dbUser.role === "admin";
        const isAdminEmail = userEmail && ADMIN_EMAILS.includes(userEmail);
        
        // If already an admin, redirect to dashboard
        if (isAdminRole || isAdminEmail) {
          return res.redirect("/admin/dashboard");
        }
        
        // If authenticated but not admin, deny access
        return res.status(403).send(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Access Denied</h1>
              <p>You do not have admin privileges. This area is restricted to administrators only.</p>
              <a href="/" style="color: #0DA9A4; text-decoration: none;">Return to Home</a>
            </body>
          </html>
        `);
      } catch (error) {
        console.error("Error checking admin status:", error);
      }
    }
    
    // Not authenticated, proceed with login
    req.session.adminLogin = true;
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
      callbackURL: `${req.protocol}://${req.hostname}/admin/auth/callback`,
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  // Admin callback - redirects to admin dashboard after successful admin login
  app.get("/admin/auth/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    const isAdminLogin = req.session.adminLogin;
    delete req.session.adminLogin;

    passport.authenticate(`replitauth:${req.hostname}`, {
      callbackURL: `${req.protocol}://${req.hostname}/admin/auth/callback`,
    }, async (err: any, user: any) => {
      if (err || !user) {
        return res.redirect("/admin/auth/login");
      }

      // Check if user has admin role or is in admin allowlist
      try {
        const userId = user.claims.sub;
        const userEmail = user.claims.email;
        
        await storage.upsertUser({
          id: userId,
          email: userEmail,
          firstName: user.claims.first_name,
          lastName: user.claims.last_name,
          profileImageUrl: user.claims.profile_image_url,
        });

        let dbUser = await storage.getUser(userId);
        
        // Check if email is in admin allowlist
        const isAdminEmail = userEmail && ADMIN_EMAILS.includes(userEmail);
        
        // Auto-promote if in allowlist but not admin yet
        if (isAdminEmail && dbUser && dbUser.role !== "admin") {
          console.log(`[SECURITY] Auto-promoting allowlisted email to admin during login: ${userEmail}`);
          await storage.updateUserRole(userId, "admin");
          dbUser = await storage.getUser(userId); // Refresh user data
        }
        
        // Check admin access
        const hasAdminAccess = (dbUser && dbUser.role === "admin") || isAdminEmail;
        
        if (!hasAdminAccess) {
          console.log(`Admin access denied for user ${userId} (${userEmail}). Role: ${dbUser?.role}, In allowlist: ${isAdminEmail}`);
          return res.status(403).send(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Access Denied</h1>
                <p>You do not have admin privileges. Only administrators can access this area.</p>
                <a href="/">Return to Home</a>
              </body>
            </html>
          `);
        }

        req.logIn(user, (err) => {
          if (err) {
            return next(err);
          }
          res.redirect("/admin/dashboard");
        });
      } catch (error) {
        console.error("Error during admin login:", error);
        res.status(500).send("Internal server error");
      }
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};

// Admin email allowlist - fallback for reliable access
const ADMIN_EMAILS = [
  "admin@tembea.test",
  "admin@test.com", // For E2E testing
  "jameskaminah3@gmail.com", // Primary admin user
];

export const requireAdmin: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  // First check if user is authenticated
  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized - Please log in" });
  }

  // Get user from database to check role
  try {
    const userId = user.claims.sub;
    const userEmail = user.claims.email;
    const dbUser = await storage.getUser(userId);
    
    // Check if user has admin role OR is in the admin email allowlist
    const isAdminRole = dbUser && dbUser.role === "admin";
    const isAdminEmail = userEmail && ADMIN_EMAILS.includes(userEmail);
    
    if (!isAdminRole && !isAdminEmail) {
      console.log(`Access denied for user ${userId} (${userEmail}). Role: ${dbUser?.role}, In allowlist: ${isAdminEmail}`);
      return res.status(403).json({ message: "Forbidden - Admin access required" });
    }

    // If user is in allowlist but doesn't have admin role in DB, update it
    if (isAdminEmail && dbUser && dbUser.role !== "admin") {
      try {
        console.log(`[SECURITY] Auto-promoting allowlisted email to admin: ${userEmail}`);
        await storage.updateUserRole(userId, "admin");
      } catch (updateError) {
        console.error(`[SECURITY] Failed to auto-promote user to admin:`, updateError);
        // Continue anyway if user is in allowlist - allow access even if role update fails
      }
    }

    // Refresh token if needed (same logic as isAuthenticated)
    const now = Math.floor(Date.now() / 1000);
    if (now > user.expires_at) {
      const refreshToken = user.refresh_token;
      if (!refreshToken) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const config = await getOidcConfig();
      const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
      updateUserSession(user, tokenResponse);
    }

    return next();
  } catch (error) {
    console.error("Error checking admin role:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
