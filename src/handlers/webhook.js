const twilio = require('twilio');
const DatabaseService = require('../services/supabase');
const GroqService = require('../services/groq');
const BookingAgent = require('../agents/booking');
const TwilioService = require('../services/twilio');
const { format } = require('date-fns');

class WebhookHandler {
  constructor() {
    this.twiml = new twilio.twiml.MessagingResponse();
  }

  async handleIncomingMessage(req, res) {
    try {
      // Validate Twilio signature in production
      if (process.env.NODE_ENV === 'production') {
        const isValid = TwilioService.validateWebhookSignature(req);
        if (!isValid) {
          console.error('Invalid Twilio signature');
          return res.status(403).send('Invalid signature');
        }
      }

      const userPhone = req.body.From.replace('whatsapp:', '');
      const message = req.body.Body.trim();
      
      console.log(`📱 Message from ${userPhone}: ${message}`);
      
      // Check for admin commands
      if (message.startsWith('/')) {
        return await this.handleAdminCommand(userPhone, message, res);
      }
      
      // Determine business context
      const business = await this.determineBusiness(userPhone);
      if (!business) {
        return this.sendResponse(res, "I couldn't find a business associated with this number. Please contact the business directly.");
      }
      
      // Get or create conversation
      const conversation = await DatabaseService.getOrCreateConversation(userPhone, business.id);
      
      // Add user message to history
      await DatabaseService.addMessageToHistory(conversation.id, 'user', message);
      
      // Process with AI
      const aiResponse = await GroqService.processMessage(message, {
        business,
        conversation
      });
      
      console.log(`🤖 AI Response - Intent: ${aiResponse.intent}, Action: ${aiResponse.action}`);
      
      // Handle based on intent
      let botResponse = aiResponse.response;
      
      if (aiResponse.intent === 'booking' && aiResponse.action === 'confirm') {
        // Use Booking Agent for final confirmation
        const bookingAgent = new BookingAgent(business);
        const bookingResult = await bookingAgent.processBooking(
          aiResponse.data,
          conversation,
          userPhone
        );
        
        if (bookingResult.success) {
          botResponse = bookingResult.message;
          
          // Update conversation state
          await DatabaseService.updateConversation(conversation.id, {
            current_state: 'booking_completed',
            pending_booking_id: bookingResult.bookingId
          });
          
          // Send confirmation via Twilio
          await TwilioService.sendConfirmation(userPhone, {
            id: bookingResult.bookingId,
            service: aiResponse.data.service,
            date: format(new Date(aiResponse.data.date), 'MMM dd, yyyy'),
            time: aiResponse.data.time
          });
        } else {
          botResponse = bookingResult.message;
        }
      }
      
      else if (aiResponse.intent === 'cancellation') {
        // Handle cancellation
        const bookingAgent = new BookingAgent(business);
        const bookings = await DatabaseService.getBookingsByCustomer(userPhone, business.id);
        
        if (bookings.length === 0) {
          botResponse = "You don't have any upcoming bookings to cancel.";
        } else if (bookings.length === 1) {
          // Auto-cancel if only one booking
          const result = await bookingAgent.cancelBooking(
            bookings[0].id,
            aiResponse.data.notes || 'Customer requested'
          );
          botResponse = result.message;
        } else {
          // Ask which booking to cancel
          botResponse = "You have multiple bookings. Please specify which one you'd like to cancel:\n" +
            bookings.map((b, i) => `${i + 1}. ${b.service_name} on ${format(new Date(b.start_time), 'MMM dd')} at ${format(new Date(b.start_time), 'h:mm a')}`).join('\n');
        }
      }
      
      else if (aiResponse.intent === 'reschedule') {
        // Handle rescheduling
        const bookingAgent = new BookingAgent(business);
        const bookings = await DatabaseService.getBookingsByCustomer(userPhone, business.id);
        
        if (bookings.length === 0) {
          botResponse = "You don't have any bookings to reschedule.";
        } else if (bookings.length === 1 && aiResponse.data.date && aiResponse.data.time) {
          // Auto-reschedule if date/time provided
          const newDateTime = new Date(`${aiResponse.data.date}T${aiResponse.data.time}`);
          const result = await bookingAgent.rescheduleBooking(
            bookings[0].id,
            newDateTime,
            conversation
          );
          botResponse = result.message;
        } else {
          // Need more information
          botResponse = aiResponse.response;
        }
      }
      
      // Update conversation with bot response
      await DatabaseService.addMessageToHistory(conversation.id, 'assistant', botResponse);
      
      // Update conversation state
      await DatabaseService.updateConversation(conversation.id, {
        current_state: aiResponse.intent,
        last_intent: aiResponse.intent
      });
      
      // Send response
      return this.sendResponse(res, botResponse);
      
    } catch (error) {
      console.error('Webhook handler error:', error);
      return this.sendResponse(res, "I encountered an error processing your request. Please try again in a moment.");
    }
  }

  async handleAdminCommand(userPhone, message, res) {
    try {
      // Find business by owner phone
      const business = await DatabaseService.getBusinessByPhone(userPhone);
      if (!business) {
        return this.sendResponse(res, "You don't have a business account. Use /setup to create one.");
      }
      
      const command = message.split(' ')[0];
      const args = message.slice(command.length).trim();
      
      switch (command) {
        case '/setup':
          return this.sendResponse(res, "Business setup is complete. You can now receive bookings.");
          
        case '/status':
          const bookingsCount = await this.getTodayBookingsCount(business.id);
          return this.sendResponse(res, `Business Status:\n- Name: ${business.name}\n- Type: ${business.business_type}\n- Today's bookings: ${bookingsCount}\n- Calendar: ${business.google_calendar_credentials ? 'Connected' : 'Not connected'}`);
          
        case '/connect-calendar':
          const CalendarService = require('../services/calendar');
          const authUrl = CalendarService.generateAuthUrl(business.id);
          return this.sendResponse(res, `Connect Google Calendar:\n1. Open this link: ${authUrl}\n2. Authorize access\n3. Your calendar will sync automatically`);
          
        case '/calendar-status':
          const calendarStatus = business.google_calendar_credentials ? 'Connected ✅' : 'Not connected ❌';
          return this.sendResponse(res, `Calendar Status: ${calendarStatus}\nCalendar ID: ${business.google_calendar_id || 'Not set'}`);
          
        case '/help':
          return this.sendResponse(res, `Admin Commands:\n/setup - Setup business\n/status - Business status\n/connect-calendar - Connect Google Calendar\n/calendar-status - Check calendar connection\n/test-calendar - Test calendar sync\n/update-hours - Update business hours\n/today - Today's bookings`);
          
        case '/today':
          const todayBookings = await this.getTodayBookings(business.id);
          if (todayBookings.length === 0) {
            return this.sendResponse(res, "No bookings for today.");
          }
          const bookingsList = todayBookings.map(b => 
            `${b.service_name} - ${format(new Date(b.start_time), 'h:mm a')} (${b.customer_name || b.customer_phone})`
          ).join('\n');
          return this.sendResponse(res, `Today's bookings (${todayBookings.length}):\n${bookingsList}`);
          
        default:
          return this.sendResponse(res, `Unknown command: ${command}. Use /help for available commands.`);
      }
    } catch (error) {
      console.error('Admin command error:', error);
      return this.sendResponse(res, "Error processing admin command.");
    }
  }

  // Critical Point to determine business context - Inno 7 Jan 17:12

  async determineBusiness(userPhone) {
    // For MVP: Use the first business or phone mapping
    // In production, you'd have a proper mapping
    
    // Check if user is a business owner
    const business = await DatabaseService.getBusinessByPhone(userPhone);
    if (business) {
      return business;
    }
    
    // For customers: Use default business or implement proper routing
    // This is a simplified version 
    const { data: businesses } = await DatabaseService.supabase
      .from('businesses')
      .select('*')
      .limit(1);
    
    return businesses?.[0] || null;
  }

  async getTodayBookingsCount(businessId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const { count, error } = await DatabaseService.supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'confirmed')
      .gte('start_time', today.toISOString())
      .lt('start_time', tomorrow.toISOString());
    
    return error ? 0 : count;
  }

  async getTodayBookings(businessId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const { data, error } = await DatabaseService.supabase
      .from('bookings')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'confirmed')
      .gte('start_time', today.toISOString())
      .lt('start_time', tomorrow.toISOString())
      .order('start_time', { ascending: true });
    
    return error ? [] : data;
  }

  sendResponse(res, message) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(message);
    
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  }
}

module.exports = new WebhookHandler();