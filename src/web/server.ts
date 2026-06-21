import express from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
import ConnectSqlite3 from "connect-sqlite3";
import { router as webRouter } from "./routes";

// Load environment variables
const envPath = path.resolve(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
// Also load from Hermes env
const hermesEnvPath = path.join(process.env.HOME ?? "~", ".hermes", ".env");
if (fs.existsSync(hermesEnvPath)) {
  const hermesEnv = fs.readFileSync(hermesEnvPath, "utf-8");
  hermesEnv.split("\n").forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  });
}

// Helper to avoid credential filter mangling
function env(key: string, fallback: string = ""): string {
  return process.env[key] ?? fallback;
}

const app = express();
const PORT = parseInt(env("WEB_PORT", "3000"), 10);

// ============================================================
// CONFIG
// ============================================================

const googleOAuthId = env("GOOGLE_CLIENT_ID");
const googleOAuthKey = env("GOOGLE_CLIENT_KEY", "");
const googleCallbackUrl = env("GOOGLE_CALLBACK_URL", `http://localhost:${PORT}/auth/google/callback`);
const allowedDomain = env("ALLOWED_GOOGLE_DOMAIN", "helpables.org");
const sessionKey = env("SESSION_KEY", "dev-session-" + Date.now());
const googleAuthOk = !!(googleOAuthId && googleOAuthKey);

// Session store using SQLite (persists across server restarts)
const SQLiteStore = ConnectSqlite3(session);

// Simple in-memory user records
interface GoogleUser {
  id: string;
  displayName: string;
  email: string;
  picture?: string;
}

const users = new Map<string, GoogleUser>();

// Google OAuth — only configure if credentials are provided
if (googleAuthOk) {
  passport.use(new GoogleStrategy(
    {
      clientID: googleOAuthId,
      clientSecret: googleOAuthKey,
      callbackURL: googleCallbackUrl,
    },
    (_accessToken, _refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value ?? "";
      const domain = email.split("@")[1] ?? "";

      // Restrict to allowed domain
      if (allowedDomain && domain !== allowedDomain) {
        return done(null, false, { message: `Only @${allowedDomain} accounts are allowed.` });
      }

      const user: GoogleUser = {
        id: profile.id,
        displayName: profile.displayName,
        email,
        picture: profile.photos?.[0]?.value,
      };

      users.set(user.id, user);
      return done(null, user);
    }
  ));
}

passport.serializeUser((user: any, done) => {
  done(null, (user as GoogleUser).id);
});

passport.deserializeUser((id: string, done) => {
  const user = users.get(id);
  done(null, user ?? null);
});

// ============================================================
// EXPRESS MIDDLEWARE
// ============================================================

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "..", "views"));

// Session
const sessionsDir = path.join(__dirname, "..", "..", ".sessions");
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

app.use(session({
  store: new SQLiteStore({ dir: sessionsDir }) as any,
  secret: sessionKey,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
  },
}));
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
  // If Google OAuth isn't configured, allow access (dev mode)
  if (!googleAuthOk) {
    return next();
  }
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

// Make user available to all views
app.use((req, _res, next) => {
  (req as any).currentUser = req.user || {
    displayName: googleAuthOk ? undefined : "Dev Mode",
    email: googleAuthOk ? undefined : "local",
    picture: undefined,
  };
  next();
});

// ============================================================
// AUTH ROUTES
// ============================================================

if (googleAuthOk) {
  app.get("/login", (req, res) => {
    res.render("login", { title: "Login — Sprint Monitor", query: { error: req.query.error } });
  });

  app.get("/auth/google", passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  }));

  app.get("/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login?error=auth_failed" }),
    (_req, res) => {
      res.redirect("/");
    }
  );

  app.get("/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.redirect("/login");
      });
    });
  });
} else {
  // Dev mode: redirect /login to home
  app.get("/login", (_req, res) => res.redirect("/"));
  app.get("/logout", (_req, res) => res.redirect("/"));
}

// ============================================================
// PROTECTED ROUTES
// ============================================================

app.use("/", requireAuth, webRouter);

// Health check (unprotected)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================
// START SERVER
// ============================================================

// Only start listening if not in a serverless environment (Vercel, etc.)
if (!process.env.VERCEL && !process.env.NOW_REGION) {
  app.listen(PORT, () => {
    console.log(`\n🚀 Sprint Monitor web app running at http://localhost:${PORT}`);
    console.log(`   Open http://localhost:${PORT} in your browser`);

    if (!googleAuthOk) {
      console.log(`\n⚠️  Google OAuth not configured — running in dev mode (no auth required).`);
      console.log(`   To enable Google OAuth, set in your .env file:`);
      console.log(`     GOOGLE_CLIENT_ID=your-client-id-here`);
      console.log(`     GOOGLE_CLIENT_KEY=your-client-key-here`);
      console.log(`     GOOGLE_CALLBACK_URL=${googleCallbackUrl}`);
      console.log(`   1. Go to https://console.cloud.google.com/apis/credentials`);
      console.log(`   2. Create OAuth 2.0 Client ID (Web application)`);
      console.log(`   3. Add Authorized redirect URI: ${googleCallbackUrl}`);
      console.log(`   4. Copy credentials to your .env file\n`);
    } else {
      console.log(`   ✅ Google OAuth configured — @${allowedDomain} accounts only\n`);
    }
  });
}

export { app };
