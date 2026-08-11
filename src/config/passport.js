const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { getPrisma } = require('./prisma');

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in the root .env file.');
}

const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback';

// Store only the user id in the session.
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Load the user from the session; verify the user still exists in the
// database so a deleted account cannot keep using an old valid session.
passport.deserializeUser(async (id, done) => {
  try {
    const prisma = await getPrisma();
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      return done(null, false);
    }
    return done(null, user);
  } catch (error) {
    return done(error);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
      scope: ['profile', 'email'],
      // OAuth CSRF protection: generates a random state stored in the session
      // (uid(24) under req.session['oauth2:accounts.google.com']), sends it on
      // the authorization redirect, and on the callback deletes it and only
      // succeeds on an exact match. Missing, mismatched, or reused state is
      // rejected (one-time use), so an attacker can no longer pre-queue a
      // victim's login CSRF without possessing the victim's state.
      state: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const prisma = await getPrisma();

        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        if (!email) {
          return done(null, false, { message: 'Google account has no email address.' });
        }

        const avatarUrl = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

        const user = await prisma.user.upsert({
          where: { email },
          update: {},
          create: {
            googleId: profile.id,
            email,
            name: profile.displayName || email,
            ...(avatarUrl ? { avatarUrl } : {}),
          },
        });

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

module.exports = passport;
