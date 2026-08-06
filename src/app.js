const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const session = require('express-session');
const passport = require('./config/passport');
const sessionConfig = require('./config/session');
const authRoutes = require('./routes/auth.routes');
const campaignRoutes = require('./routes/campaign.routes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(session(sessionConfig));
app.use(passport.initialize());
app.use(passport.session());
app.use(authRoutes);
app.use('/campaigns', campaignRoutes);

module.exports = app;
