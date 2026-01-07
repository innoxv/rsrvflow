require('dotenv').config();

module.exports = {
  // Server
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  
  // Twilio
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886'
  },
  
  // Groq AI
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'mixtral-8x7b-32768',
    temperature: 0.3,
    maxTokens: 500
  },
  
  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_KEY
  },
  
  // Google Calendar
  googleCalendar: {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI,
    scopes: ['https://www.googleapis.com/auth/calendar']
  },
  
  // Booking Settings
  booking: {
    bufferMinutes: parseInt(process.env.BOOKING_BUFFER_MINUTES) || 15,
    maxAdvanceDays: parseInt(process.env.MAX_ADVANCE_BOOKING_DAYS) || 90,
    reminderHoursBefore: parseInt(process.env.REMINDER_HOURS_BEFORE) || 24,
    allowSameDay: process.env.ALLOW_SAME_DAY_BOOKING !== 'false'
  },
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info'
};