import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { storage } from "./storage";
import type { User } from "@shared/schema";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  if (!stored || !stored.includes(".")) return false;
  const [hashedPart, salt] = stored.split(".");
  if (!hashedPart || !salt) return false;
  const hashedBuf = Buffer.from(hashedPart, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

function getPublicDomain(): string | null {
  return (
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ||
    process.env.REPLIT_DEV_DOMAIN?.trim() ||
    null
  );
}

export function setupAuth() {
  passport.use(
    new LocalStrategy({ usernameField: 'email', passwordField: 'password' }, async (email, password, done) => {
      try {
        const normalized = email.trim().toLowerCase();
        const user = await storage.getUserByEmail(normalized);
        if (!user) {
          return done(null, false, { message: "Invalid email or password" });
        }
        const valid = await comparePasswords(password, user.password);
        if (!valid) {
          return done(null, false, { message: "Invalid email or password" });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  // ── Google OAuth ──────────────────────────────────────────────────────────

  const replitDomain = getPublicDomain();
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleCallbackUrl =
    process.env.GOOGLE_CALLBACK_URL ||
    (replitDomain ? `https://${replitDomain}/auth/google/callback` : "/auth/google/callback");

  if (googleClientId && googleClientSecret) {
    passport.use(
      "google",
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: googleCallbackUrl,
          scope: ["email", "profile"],
          passReqToCallback: true,
        },
        async (req: any, _accessToken: string, _refreshToken: string, profile: any, done: any) => {
          try {
            const oauthId = `google_${profile.id}`;
            const email = profile.emails?.[0]?.value as string | undefined;
            const displayName = profile.displayName as string | undefined;
            const avatarUrl = profile.photos?.[0]?.value as string | undefined;

            let user = await storage.getUserByGoogleId(oauthId);
            if (user) {
              req.session.oauthFlow = { isNewUser: false, provider: "google" };
              return done(null, user);
            }

            if (email) {
              user = await storage.getUserByEmail(email.toLowerCase());
              if (user) {
                user = await storage.updateUser(user.id, {
                  googleId: oauthId,
                  avatarUrl: avatarUrl ?? user.avatarUrl,
                  displayName: user.displayName ?? displayName,
                  emailVerified: true,
                });
                req.session.oauthFlow = { isNewUser: false, provider: "google" };
                return done(null, user);
              }
            }

            const resolvedEmail = email?.toLowerCase() ?? `google_${profile.id}@google.oauth`;
            const baseUsername = (displayName || `google_${profile.id}`).toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 24) || `google_${profile.id}`;
            let username = baseUsername;
            let counter = 1;
            while (await storage.getUserByUsername(username)) {
              username = `${baseUsername}_${counter}`.slice(0, 32);
              counter += 1;
            }
            const unusablePassword = `oauth_${randomBytes(32).toString("hex")}`;
            const newUser = await storage.createUser({
              username,
              email: resolvedEmail,
              password: unusablePassword,
              displayName: displayName ?? undefined,
              avatarUrl: avatarUrl ?? undefined,
              googleId: oauthId,
              emailVerified: true,
              onboardingStep: 0,
            });
            req.session.oauthFlow = { isNewUser: true, provider: "google" };
            return done(null, newUser);
          } catch (err) {
            return done(err as Error);
          }
        }
      )
    );
  }

  passport.serializeUser((user: Express.User, done) => {
    done(null, (user as User).id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUserById(id);
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  });
}
