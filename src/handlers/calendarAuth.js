const express = require('express');
const router = express.Router();
const GoogleCalendarService = require('../services/calendar');
const DatabaseService = require('../services/supabase');

// Generate OAuth URL
router.get('/auth/url/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const business = await DatabaseService.getBusinessById(businessId);
    if (!business) {
      return res.status(404).json({
        success: false,
        error: 'Business not found'
      });
    }
    
    const authUrl = GoogleCalendarService.generateAuthUrl(businessId);
    
    res.json({
      success: true,
      authUrl,
      business: {
        id: business.id,
        name: business.name
      },
      instructions: 'Open this URL in a browser to authorize Google Calendar access. After authorization, you will be redirected back to complete the setup.'
    });
    
  } catch (error) {
    console.error('Auth URL error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// OAuth callback handler
router.get('/auth/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;
    
    if (oauthError) {
      return res.status(400).send(`
        <html>
          <head><title>Authorization Failed</title></head>
          <body>
            <h2>Authorization Failed</h2>
            <p>Error: ${oauthError}</p>
            <p>Please try again.</p>
          </body>
        </html>
      `);
    }
    
    if (!code) {
      return res.status(400).send(`
        <html>
          <head><title>Missing Code</title></head>
          <body>
            <h2>Authorization Failed</h2>
            <p>Missing authorization code.</p>
          </body>
        </html>
      `);
    }
    
    let businessId;
    try {
      const stateData = JSON.parse(state || '{}');
      businessId = stateData.businessId;
    } catch (e) {
      return res.status(400).send(`
        <html>
          <head><title>Invalid State</title></head>
          <body>
            <h2>Authorization Failed</h2>
            <p>Invalid state parameter.</p>
          </body>
        </html>
      `);
    }
    
    if (!businessId) {
      return res.status(400).send(`
        <html>
          <head><title>Missing Business</title></head>
          <body>
            <h2>Authorization Failed</h2>
            <p>Missing business ID.</p>
          </body>
        </html>
      `);
    }
    
    // Exchange code for tokens
    const tokens = await GoogleCalendarService.handleOAuthCallback(code, businessId);
    
    // Test connection
    const testResult = await GoogleCalendarService.testConnection(businessId);
    
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Calendar Connected</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
              margin: 0;
              padding: 20px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .card {
              background: white;
              border-radius: 20px;
              padding: 40px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 500px;
              width: 100%;
              text-align: center;
            }
            .success-icon {
              font-size: 60px;
              margin-bottom: 20px;
            }
            h1 {
              color: #333;
              margin-bottom: 10px;
            }
            p {
              color: #666;
              line-height: 1.6;
              margin-bottom: 20px;
            }
            .status {
              background: #e8f5e9;
              border-radius: 10px;
              padding: 15px;
              margin: 20px 0;
              text-align: left;
            }
            .status.success {
              background: #e8f5e9;
              border-left: 4px solid #4caf50;
            }
            .close-btn {
              background: #4caf50;
              color: white;
              border: none;
              padding: 12px 30px;
              border-radius: 25px;
              font-size: 16px;
              cursor: pointer;
              margin-top: 20px;
              transition: background 0.3s;
            }
            .close-btn:hover {
              background: #388e3c;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="success-icon">✅</div>
            <h1>Google Calendar Connected!</h1>
            <p>Your WhatsApp booking bot is now synced with Google Calendar.</p>
            
            <div class="status success">
              <strong>Connection Status:</strong> Successful<br>
              <strong>Calendar ID:</strong> ${testResult.calendarId || 'primary'}<br>
              <strong>Business:</strong> ${businessId}<br>
              <strong>Expires:</strong> ${new Date(tokens.expiry_date).toLocaleDateString()}
            </div>
            
            <p>All future bookings will automatically sync to your Google Calendar.</p>
            <p>You can now close this window and return to WhatsApp.</p>
            
            <button class="close-btn" onclick="window.close()">Close Window</button>
            
            <script>
              // Send message to opener if exists
              if (window.opener) {
                window.opener.postMessage({
                  type: 'calendar-connected',
                  businessId: '${businessId}',
                  success: true
                }, '*');
              }
              
              // Auto-close after 5 seconds
              setTimeout(() => {
                window.close();
              }, 5000);
            </script>
          </div>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`
      <html>
        <head><title>Connection Failed</title></head>
        <body>
          <h2>Connection Failed</h2>
          <p>Error: ${error.message}</p>
          <p>Please try again or contact support.</p>
        </body>
      </html>
    `);
  }
});

// Check calendar connection status
router.get('/status/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const business = await DatabaseService.getBusinessById(businessId);
    if (!business) {
      return res.status(404).json({
        success: false,
        error: 'Business not found'
      });
    }
    
    const isConnected = !!business.google_calendar_credentials;
    let testResult = null;
    
    if (isConnected) {
      testResult = await GoogleCalendarService.testConnection(businessId);
    }
    
    res.json({
      success: true,
      connected: isConnected,
      calendarId: business.google_calendar_id,
      testResult,
      business: {
        id: business.id,
        name: business.name,
        type: business.business_type
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test calendar sync
router.post('/test/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const business = await DatabaseService.getBusinessById(businessId);
    if (!business) {
      return res.status(404).json({
        success: false,
        error: 'Business not found'
      });
    }
    
    if (!business.google_calendar_credentials) {
      return res.status(400).json({
        success: false,
        error: 'Google Calendar not connected'
      });
    }
    
    // Test by getting available slots for tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const slots = await GoogleCalendarService.getAvailableSlots(
      businessId,
      tomorrow,
      60 // 60-minute test slot
    );
    
    // Try to create a test event
    const testEvent = {
      service: 'Test Appointment',
      customerName: 'Test Customer',
      customerPhone: '+1234567890',
      startTime: new Date(tomorrow.setHours(10, 0, 0, 0)),
      endTime: new Date(tomorrow.setHours(11, 0, 0, 0)),
      bookingId: 'test-' + Date.now(),
      notes: 'Test event from WhatsApp Booking Bot'
    };
    
    const eventResult = await GoogleCalendarService.createBookingEvent(businessId, testEvent);
    
    // Clean up test event
    if (eventResult.success) {
      setTimeout(async () => {
        try {
          await GoogleCalendarService.cancelBookingEvent(
            businessId,
            'test-booking',
            'Test cleanup'
          );
        } catch (e) {
          // Ignore cleanup errors
        }
      }, 5000);
    }
    
    res.json({
      success: true,
      testDate: tomorrow.toISOString(),
      connectionTest: {
        connected: true,
        calendarId: business.google_calendar_id
      },
      availabilityTest: {
        slotsAvailable: slots.available,
        slotsCount: slots.slots?.length || 0,
        businessHours: slots.businessHours
      },
      eventTest: {
        created: eventResult.success,
        eventId: eventResult.eventId,
        eventLink: eventResult.eventLink
      },
      summary: eventResult.success ? 
        'Calendar integration is working correctly!' :
        'Calendar integration test completed with some issues.'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Calendar integration test failed'
    });
  }
});

// Disconnect calendar
router.post('/disconnect/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    await DatabaseService.supabase
      .from('businesses')
      .update({
        google_calendar_credentials: null,
        google_calendar_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', businessId);
    
    res.json({
      success: true,
      message: 'Google Calendar disconnected successfully',
      businessId
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;