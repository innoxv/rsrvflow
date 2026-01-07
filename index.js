const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const webhookHandler = require('./src/handlers/webhook');
const businessHandler = require('./src/handlers/business');
const calendarAuthRouter = require('./src/handlers/calendarAuth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    nairobiTime: new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }),
    service: 'RSRVFLOW WhatsApp Booking Bot',
    version: '2.0.1',
    features: ['booking', 'ai-chat', 'kenya-optimized']
  });
});

// Simple home page
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>RSRVFLOW Booking Bot</title></head>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h1>🤖 RSRVFLOW Booking Bot</h1>
        <p>✅ Server is running</p>
        <p>🌍 Timezone: Africa/Nairobi</p>
        <p>📱 Webhook: <code>POST /webhook</code></p>
        <p>🔧 Health: <a href="/health">/health</a></p>
        <hr>
        <p>Status: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</p>
      </body>
    </html>
  `);
});

// Webhook endpoint
app.post('/webhook', webhookHandler.handleIncomingMessage);

// Admin endpoints
app.post('/admin/setup', businessHandler.setupBusiness);
app.get('/admin/config/:businessId', businessHandler.getBusinessConfig);

// Calendar endpoints (optional)
app.use('/calendar', calendarAuthRouter);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 RSRVFLOW Bot running on port ${PORT}`);
  console.log(`🌍 Timezone: ${process.env.TIMEZONE || 'Africa/Nairobi'}`);
  console.log(`📱 Webhook: http://localhost:${PORT}/webhook`);
  console.log(`🔧 Health: http://localhost:${PORT}/health`);
  
  // Initialize scheduler safely
  if (process.env.NODE_ENV === 'production' && !process.env.DISABLE_SCHEDULER) {
    setTimeout(() => {
      try {
        const scheduler = require('./src/services/scheduler');
        console.log('⏰ Scheduler initialized (reminders at 9AM Nairobi)');
      } catch (error) {
        console.log('⚠️ Scheduler disabled due to error');
      }
    }, 5000); // Wait 5 seconds after startup
  }
});

module.exports = app;