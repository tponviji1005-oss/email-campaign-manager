const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const session = require('express-session');
const passport = require('./config/passport');
const sessionConfig = require('./config/session');
const authRoutes = require('./routes/auth.routes');
const campaignRoutes = require('./routes/campaign.routes');
const emailRoutes = require('./routes/email.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const webhookRoutes = require('./routes/webhook.routes');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const app = express();

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(session(sessionConfig));
app.use(passport.initialize());
app.use(passport.session());
app.use(authRoutes);
app.use('/campaigns', campaignRoutes);
app.use('/email', emailRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/webhooks', webhookRoutes);

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON body' });
  }
  next(err);
});

module.exports = app;
