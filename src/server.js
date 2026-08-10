const app = require('./app');
const { isSmtpConfigured, getMissingSmtpVars, getSmtpEndpointSummary } = require('./config/mail');
const { getEmailProvider, isBrevoConfigured } = require('./config/brevo');
require('./workers/email.worker');
require('./queues/email.events');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  const provider = getEmailProvider();

  if (provider === 'brevo') {
    console.log('Email provider: Brevo');
    console.log(`Brevo configured: ${isBrevoConfigured()}`);
  } else if (isSmtpConfigured()) {
    const { host, port, secure } = getSmtpEndpointSummary();
    console.log(`SMTP configured: host=${host} port=${port} secure=${secure}`);
  } else {
    console.warn(
      `SMTP is NOT configured. Missing variable(s): ${getMissingSmtpVars().join(', ')}. ` +
        'Set them in the .env file to enable email delivery.'
    );
  }
});
