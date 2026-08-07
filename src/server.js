const app = require('./app');
require('./workers/email.worker');
require('./queues/email.events');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
