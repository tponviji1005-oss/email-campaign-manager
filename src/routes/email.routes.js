const express = require('express');

// The standalone /email/send and /email/queue endpoints were removed:
// they were unused by the application and allowed unauthenticated callers to
// trigger real email delivery through the provider. Campaign delivery is the
// only supported path: POST /campaigns -> BullMQ -> worker -> Brevo/Gmail.
const router = express.Router();

module.exports = router;
