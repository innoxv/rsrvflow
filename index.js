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
    service: 'rsvflow WhatsApp Booking Bot',
    version: '2.0.1',
    features: ['booking', 'ai-chat', 'kenya-optimized']
  });
});


// Home page
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Agentic WhatsApp Booking Bot</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; border-radius: 10px; }
          .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0; }
          .feature-card { border: 1px solid #E5E7EB; padding: 20px; border-radius: 8px; }
          .status { padding: 10px; background: #DCFCE7; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🤖 Agentic WhatsApp Booking Bot</h1>
          <p>AI-powered scheduling with Google Calendar integration</p>
        </div>
        
        <div class="status">
          ✅ Server is running. Webhook endpoint: <code>/webhook</code>
        </div>
        
        <div class="features">
          <div class="feature-card">
            <h3>📅 Calendar Integration</h3>
            <p>Syncs with Google Calendar in real-time</p>
          </div>
          <div class="feature-card">
            <h3>🤖 AI Agent</h3>
            <p>Natural language understanding for bookings</p>
          </div>
          <div class="feature-card">
            <h3>🏢 Multi-Business</h3>
            <p>Supports salons, dentists, restaurants, etc.</p>
          </div>
          <div class="feature-card">
            <h3>⏰ Auto Reminders</h3>
            <p>WhatsApp reminders for appointments</p>
          </div>
        </div>
        
        <h3>Endpoints:</h3>
        <ul>
          <li><code>POST /webhook</code> - Twilio WhatsApp webhook</li>
          <li><code>POST /admin/setup</code> - Business setup</li>
          <li><code>GET /calendar/auth/url/:businessId</code> - Calendar OAuth</li>
          <li><code>GET /calendar/auth/callback</code> - OAuth callback</li>
          <li><code>GET /health</code> - Health check</li>
        </ul>
                <hr>
        <p>Status: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</p>
        <p><strong>Deployed on Render</strong> | Version 2.0.1</p>
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