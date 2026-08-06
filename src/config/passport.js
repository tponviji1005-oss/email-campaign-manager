const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { getPrisma } = require('./prisma');

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in the root .env file.');
}

// Store only the user id in the session.
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Load the user from the session; DB lookup will be added in a later task.
passport.deserializeUser((id, done) => {
  done(null, { id });
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: 'http://localhost:3000/auth/google/callback',
      scope: ['profile', 'email'],
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
