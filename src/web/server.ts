import express from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as MicrosoftStrategy } from "passport-microsoft";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
import ConnectSqlite3 from "connect-sqlite3";
import { router as webRouter } from "./routes";

const isServerless = !!(process.env.VERCEL || process.env.NOW_REGION);

// Load environment variables
const envPath = path.resolve(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Helper to avoid credential filter mangling
function env(key: string, fallback: string = ""): string {
  return process.env[key] ?? fallback;
}

const app = express();
const PORT = parseInt(env("WEB_PORT", "3000"), 10);

// ============================================================
// CONFIG — Google OAuth
// ============================================================

const googleOAuthId = env("GOOGLE_CLIENT_ID");
const googleOAuthKey = env("GOOGLE_CLIENT_KEY", "");
const googleCallbackUrl = env("GOOGLE_CALLBACK_URL", `http://localhost:${PORT}/auth/google/callback`);
const allowedDomain = env("ALLOWED_GOOGLE_DOMAIN", "helpables.org");
const googleAuthOk = !!(googleOAuthId && googleOAuthKey);

// ============================================================
// CONFIG — Microsoft (Azure AD) OAuth
// ============================================================

const msClientId = env("MICROSOFT_CLIENT_ID");
const msClientSecret = env("MICROSOFT_CLIENT_SECRET", "");
const msTenant = env("MICROSOFT_TENANT", "common");
const msCallbackUrl = env("MICROSOFT_CALLBACK_URL", `http://localhost:${PORT}/auth/microsoft/callback`);
const msAuthOk = !!(msClientId && msClientSecret);

// Any auth configured?
const authOk = googleAuthOk || msAuthOk;

const sessionKey = env("SESSION_KEY", "dev-session-" + Date.now());

// Session store: use SQLite locally (persists across restarts),
// but on Vercel/serverless use default MemoryStore (filesystem is read-only).
// To survive across serverless invocations we serialize the FULL user object
// into the session cookie, not just an ID lookup into the in-memory Map.

// Generic user store (only used in non-serverless mode)
interface AppUser {
  id: string;
  displayName: string;
  email: string;
  picture?: string;
  provider: "google" | "microsoft";
}

const users = new Map<string, AppUser>();

// ============================================================
// GOOGLE OAUTH STRATEGY
// ============================================================

if (googleAuthOk) {
  passport.use("google", new GoogleStrategy(
    {
      clientID: googleOAuthId,
      clientSecret: googleOAuthKey,
      callbackURL: googleCallbackUrl,
    },
    (_accessToken, _refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value ?? "";
      const domain = email.split("@")[1] ?? "";

      if (allowedDomain && domain !== allowedDomain) {
        return done(null, false, { message: `Only @${allowedDomain} accounts are allowed.` });
      }

      const user: AppUser = {
        id: `google:${profile.id}`,
        displayName: profile.displayName,
        email,
        picture: profile.photos?.[0]?.value,
        provider: "google",
      };

      users.set(user.id, user);
      return done(null, user);
    }
  ));
}

// ============================================================
// MICROSOFT (AZURE AD) OAUTH STRATEGY
// ============================================================
// passport-microsoft uses the Microsoft identity platform v2.0 endpoint.
// Tenant can be "common" (all accounts), "organizations" (work/school only),
// or a specific tenant GUID for single-tenant apps.

if (msAuthOk) {
  passport.use("microsoft", new MicrosoftStrategy(
    {
      clientID: msClientId,
      clientSecret: msClientSecret,
      callbackURL: msCallbackUrl,
      tenant: msTenant,
    } as any,
    (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
      const email = profile?.emails?.[0]?.value ?? profile?.upn ?? "";
      const displayName = profile?.displayName ?? profile?.name?.familyName ?? "Microsoft User";

      const user: AppUser = {
        id: `microsoft:${profile?.id ?? email}`,
        displayName,
        email,
        provider: "microsoft",
      };

      users.set(user.id, user);
      return done(null, user);
    }
  ));
}

// ============================================================
// PASSPORT SERIALIZE / DESERIALIZE
// ============================================================

// Serialize the FULL user object into the session.
// On serverless (Vercel) the in-memory Map is lost between invocations,
// so we can't do an ID lookup — store everything in the session.
passport.serializeUser((user: any, done) => {
  done(null, user as AppUser);
});

passport.deserializeUser((user: AppUser, done) => {
  // On non-serverless, also update the in-memory store
  if (!isServerless && user?.id) {
    users.set(user.id, user);
  }
  done(null, user ?? null);
});

// ============================================================
// EXPRESS MIDDLEWARE
// ============================================================

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "..", "views"));

// Session configuration
const sessionConfig: session.SessionOptions = {
  secret: sessionKey,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isServerless, // HTTPS on Vercel, HTTP locally
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
  },
};

if (!isServerless) {
  // Local: use SQLite store for persistence across restarts
  const sessionsDir = path.join(__dirname, "..", "..", ".sessions");
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
  sessionConfig.store = new (ConnectSqlite3(session))({ dir: sessionsDir }) as any;
}

app.use(session(sessionConfig));
app.use(passport.initialize());
app.use(passport.session());

// Serve static files from output/ directory for artifacts
app.use("/output", express.static(path.join(__dirname, "..", "..", "output")));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // If no auth is configured at all, allow access (dev mode)
  if (!authOk) {
    return next();
  }
  if (req.isAuthenticated()) {
    return next();
  }
  // For API requests, return 401 JSON instead of redirecting
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({
      status: "error",
      message: "Authentication required. Login via /auth/microsoft or /auth/google first.",
    });
  }
  res.redirect("/login");
}

// Make user available to all views
app.use((req, _res, next) => {
  (req as any).currentUser = req.user || {
    displayName: authOk ? undefined : "Dev Mode",
    email: authOk ? undefined : "local",
    picture: undefined,
  };
  next();
});

// ============================================================
// AUTH ROUTES
// ============================================================

if (authOk) {
  app.get("/login", (req, res) => {
    res.render("login", {
      title: "Login — Sprint Monitor",
      query: { error: req.query.error },
      googleAuthOk,
      msAuthOk,
    });
  });

  // --- Google ---
  if (googleAuthOk) {
    app.get("/auth/google", passport.authenticate("google", {
      scope: ["profile", "email"],
      prompt: "select_account",
    }));

    app.get("/auth/google/callback",
      passport.authenticate("google", { failureRedirect: "/login?error=auth_failed" }),
      (_req, res) => { res.redirect("/"); }
    );
  }

  // --- Microsoft (Azure AD) ---
  if (msAuthOk) {
    app.get("/auth/microsoft", passport.authenticate("microsoft", {
      scope: ["user.read", "openid", "profile", "email"],
      prompt: "select_account",
    }));

    app.get("/auth/microsoft/callback",
      passport.authenticate("microsoft", { failureRedirect: "/login?error=ms_auth_failed" }),
      (_req, res) => { res.redirect("/"); }
    );
  }

  app.get("/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.redirect("/login");
      });
    });
  });
} else {
  // Dev mode: no auth required
  app.get("/login", (_req, res) => res.redirect("/"));
  app.get("/logout", (_req, res) => res.redirect("/"));
}

// ============================================================
// HEALTH CHECK (unprotected — for uptime monitoring)
// Registered BEFORE requireAuth so it's always accessible.
// ============================================================

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================
// PROTECTED ROUTES (web UI + JSON APIs)
// ============================================================

app.use("/", requireAuth, webRouter);

// ============================================================
// START SERVER
// ============================================================

// Only start listening if not in a serverless environment (Vercel, etc.)
if (!process.env.VERCEL && !process.env.NOW_REGION) {
  app.listen(PORT, () => {
    console.log(`\n🚀 Sprint Monitor web app running at http://localhost:${PORT}`);

    if (!authOk) {
      console.log(`\n⚠️  No OAuth configured — running in dev mode (no auth required).`);
      console.log(`   To enable Microsoft (Azure AD) OAuth, set in your .env file:`);
      console.log(`     MICROSOFT_CLIENT_ID=your-app-id`);
      console.log(`     MICROSOFT_CLIENT_SECRET=your-secret`);
      console.log(`     MICROSOFT_TENANT=common-or-tenant-guid`);
      console.log(`     MICROSOFT_CALLBACK_URL=http://localhost:${PORT}/auth/microsoft/callback`);
      console.log(`   1. Go to https://portal.azure.com → App registrations → New registration`);
      console.log(`   2. Add Redirect URI: http://localhost:${PORT}/auth/microsoft/callback`);
      console.log(`   3. API permissions: Microsoft Graph → User.Read, openid, profile, email`);
      console.log(`   4. Certificates & secrets → New client secret → copy value`);
      console.log(`   5. Copy credentials to .env\n`);
    } else {
      if (msAuthOk) console.log(`   ✅ Microsoft OAuth configured — tenant: ${msTenant}`);
      if (googleAuthOk) console.log(`   ✅ Google OAuth configured — @${allowedDomain} only`);
    }
  });
}

export { app };
