import express, { type Request, type Response, type NextFunction, type Express } from "express";
import session from "express-session";
import passport from "passport";
import helmet from "helmet";
import PgStore from "connect-pg-simple";
import { registerRoutes } from "./routes";
export { registerRoutes };
import { serveStatic } from "./static";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db, pool } from "./db";
import { sql } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import cookieParser from "cookie-parser";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function createApp() {
  const app = express();
  const httpServer = createServer(app);

  const rawTrustProxy = process.env.TRUST_PROXY ?? "1";
  const trustProxySetting = rawTrustProxy === "true" ? true : rawTrustProxy === "false" ? false : /^\d+$/.test(rawTrustProxy) ? parseInt(rawTrustProxy, 10) : rawTrustProxy;
  app.set("trust proxy", trustProxySetting);

  // Serve uploaded files (BIMI SVGs, etc.)
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  } catch {
    // Vercel serverless has a read-only filesystem — uploads won't persist,
    // which is expected. Ignore the error.
  }
  app.use("/uploads", express.static(uploadsDir));

  app.use(
    express.json({
      limit: '5mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.text({ type: "text/plain", limit: '5mb' }));

  app.use(express.urlencoded({ extended: false }));

  // Session middleware
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET environment variable must be set in production");
    }
    console.warn("[session] SESSION_SECRET not set — generating ephemeral secret (all sessions will be invalidated on restart)");
  }
  const resolvedSecret = sessionSecret || randomBytes(32).toString("hex");
  app.use(
    session({
      secret: resolvedSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
      store: new (PgStore(session))({
        pool: pool as any,
        tableName: "session",
        createTableIfMissing: true,
        pruneSessionInterval: 60,
      }),
    })
  );

  // Cookie parser — must be before CSRF and session-dependent middleware
  app.use(cookieParser());

  // Passport auth
  setupAuth();
  app.use(passport.initialize());
  app.use(passport.session());

  // CSRF protection (double-submit cookie pattern)
  // Session-based API routes are protected via SameSite=lax + httpOnly cookie.
  // This middleware provides defense-in-depth for unsafe methods.
  const csrfSafeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
  const csrfSkippedPaths = [
    "/auth/google/callback",
    "/api/contact", "/api/forgot-password", "/api/reset-password",
    "/api/public/",
    // Provider webhooks authenticate via their own HMAC signatures, not CSRF tokens.
    "/api/webhooks/",
  ];
  app.use((req, res, next) => {
    // Generate CSRF token on every request so the cookie is always available
    let csrfSession = (req.session as any).csrfToken;
    if (!csrfSession) {
      csrfSession = randomBytes(24).toString("hex");
      (req.session as any).csrfToken = csrfSession;
    }
    // Sync cookie: set if missing or out of sync with session token
    const csrfCookie = req.cookies?.["XSRF-TOKEN"];
    if (!csrfCookie || csrfCookie !== csrfSession) {
      res.cookie("XSRF-TOKEN", csrfSession, {
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        httpOnly: false,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
    // Skip validation for safe methods and public/anonymous endpoints
    if (csrfSafeMethods.has(req.method)) return next();
    if (csrfSkippedPaths.some(p => req.path.startsWith(p))) return next();
    // Validate: header must match both session and cookie
    const headerToken = req.headers["x-csrf-token"] as string;
    const cookieToken = req.cookies?.["XSRF-TOKEN"] as string;
    if (!headerToken || !csrfSession || headerToken !== csrfSession || headerToken !== cookieToken) {
      return res.status(403).json({ message: "Invalid CSRF token" });
    }
    next();
  });

  // Helmet security headers
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  // Custom CSP and additional headers
  app.use((_req, res, next) => {
    const isDev = process.env.NODE_ENV !== "production";
    const cdnSrc = "https://unpkg.com https://cdn.tailwindcss.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net";
    const scriptSrc = isDev
      ? `'self' 'unsafe-inline' 'unsafe-eval' ${cdnSrc} https://9fa523f4-b7f0-4769-942e-e2ebf496995e-00-3mhvr91md9y73.picard.replit.dev https://replit-cdn.com https://va.vercel-scripts.com`
      : `'self' ${cdnSrc}`;
    const styleSrc = isDev
      ? `'self' 'unsafe-inline' ${cdnSrc}`
      : `'self' 'unsafe-inline' ${cdnSrc}`;
    res.setHeader("Content-Security-Policy",
      `default-src 'self'; ` +
      `script-src ${scriptSrc}; ` +
      `style-src ${styleSrc}; ` +
      `font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:; ` +
      `img-src 'self' data: https:; ` +
      `connect-src 'self' https: ws:; ` +
      `frame-src 'self'; ` +
      `object-src 'none'`
    );
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
      }
    });

    next();
  });

  return { app, httpServer };
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function startServer(app: Express, httpServer: Server) {
  await registerRoutes(httpServer, app);

  // Startup health checks (non-fatal — log warnings only)
  try {
    await db.execute(sql`SELECT 1`);
    log("Database connection verified");
  } catch (e) {
    console.error("[startup] Database unreachable — check DATABASE_URL:", e);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production" && process.env.SERVE_STATIC !== "false") {
    serveStatic(app);
  } else {
    try {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    } catch (err) {
      log(`Vite not available (${err instanceof Error ? err.message : err}), serving static files instead`);
      serveStatic(app);
    }
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      (async () => {
        // SLA checker removed
      })();
    },
  );
}

// Start the server (Railway / local development)
{
  const { app, httpServer } = createApp();
  startServer(app, httpServer).catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

async function shutdown(signal: string) {
  log(`Received ${signal}, shutting down...`);
  await pool.end();
  log("Shutdown complete");
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
