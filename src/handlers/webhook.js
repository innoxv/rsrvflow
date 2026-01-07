const twilio = require('twilio');
const DatabaseService = require('../services/supabase');
const GroqService = require('../services/groq');
const TwilioService = require('../services/twilio');
const { format } = require('date-fns');

class WebhookHandler {
  constructor() {
    this.twiml = new twilio.twiml.MessagingResponse();
  }

  async handleIncomingMessage(req, res) {
    console.log('🟢 WEBHOOK CALLED at', new Date().toISOString());
    
    try {
      const userPhone = req.body.From ? req.body.From.replace('whatsapp:', '') : 'unknown';
      const message = req.body.Body ? req.body.Body.trim() : '';
      
      console.log(`📱 From: ${userPhone}, Message: "${message}"`);
      
      // SIMPLE TEST RESPONSE - Bypass all logic
      if (message.toLowerCase() === 'ping' || message.toLowerCase() === 'test') {
        return this.sendResponse(res, `✅ RSRVFLOW is working!\n\nReceived from: ${userPhone}\nMessage: "${message}"\n\nTry: "Book a haircut tomorrow at 2pm"`);
      }
      
      if (message.toLowerCase() === 'debug') {
        const debugInfo = {
          serverTime: new Date().toISOString(),
          nairobiTime: new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }),
          userPhone,
          message,
          env: {
            nodeEnv: process.env.NODE_ENV,
            hasTwilio: !!process.env.TWILIO_ACCOUNT_SID,
            hasGroq: !!process.env.GROQ_API_KEY,
            hasSupabase: !!process.env.SUPABASE_URL
          }
        };
        return this.sendResponse(res, `🔧 DEBUG INFO:\n${JSON.stringify(debugInfo, null, 2)}`);
      }
      
      // Handle /setup command directly (no business lookup needed)
      if (message.toLowerCase().startsWith('/setup')) {
        return this.handleSetupCommand(userPhone, message, res);
      }
      
      // Determine business context
      const business = await this.determineBusiness(userPhone);
      if (!business) {
        // If no business exists, guide user to setup
        if (message.toLowerCase().startsWith('/')) {
          // It's an admin command but no business
          return this.sendResponse(res, 
            "No business found for this number.\n\n" +
            "To setup a business:\n" +
            "/setup BusinessName salon +254700111001\n\n" +
            "Example: /setup MySalon salon +254700111001"
          );
        } else {
          // Customer message but no business exists
          return this.sendResponse(res, 
            "🤖 Welcome to RSRVFLOW!\n\n" +
            "I'm a booking assistant, but no business is configured yet.\n\n" +
            "If you're a BUSINESS OWNER:\n" +
            "/setup BusinessName Type Phone\n\n" +
            "If you're a CUSTOMER:\n" +
            "Please ask the business owner to setup first."
          );
        }
      }
      
      console.log(`🏢 Using business: ${business.name} (${business.business_type})`);
      
      // Handle other admin commands
      if (message.startsWith('/')) {
        return this.handleAdminCommand(userPhone, message, business, res);
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
        try {
          const BookingAgent = require('../agents/booking');
          const bookingAgent = new BookingAgent(business);
          const bookingResult = await bookingAgent.processBooking(
            aiResponse.data,
            conversation,
            userPhone
          );
          
          if (bookingResult.success) {
            botResponse = bookingResult.message;
            
            await DatabaseService.updateConversation(conversation.id, {
              current_state: 'booking_completed',
              pending_booking_id: bookingResult.bookingId
            });
            
            // Send confirmation
            await TwilioService.sendConfirmation(userPhone, {
              id: bookingResult.bookingId,
              service: aiResponse.data.service,
              date: format(new Date(aiResponse.data.date), 'MMM dd, yyyy'),
              time: aiResponse.data.time
            });
          } else {
            botResponse = bookingResult.message;
          }
        } catch (error) {
          console.error('Booking processing error:', error);
          botResponse = "I encountered an error processing your booking. Please try again or contact the business directly.";
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
      console.error('❌ Webhook handler error:', error);
      console.error('Error stack:', error.stack);
      
      // Still respond to user even on error
      return this.sendResponse(res, 
        "I encountered an error processing your request. Please try again in a moment.\n\n" +
        "Error: " + error.message
      );
    }
  }

  async determineBusiness(userPhone) {
    try {
      console.log(`🔍 Looking up business for phone: ${userPhone}`);
      
      // First check if user is a business owner
      const business = await DatabaseService.getBusinessByPhone(userPhone);
      if (business) {
        console.log(`✅ Found business: ${business.name}`);
        return business;
      }
      
      console.log(`❌ No business found for phone: ${userPhone}`);
      
      // For customers: Use first business for now
      const { data: businesses, error } = await DatabaseService.supabase
        .from('businesses')
        .select('*')
        .limit(1);
      
      if (error) {
        console.error('Error querying businesses:', error);
        return null;
      }
      
      if (!businesses || businesses.length === 0) {
        console.log('⚠️ No businesses in database');
        return null;
      }
      
      console.log(`📋 Using first business: ${businesses[0].name}`);
      return businesses[0];
      
    } catch (error) {
      console.error('❌ Error in determineBusiness:', error.message);
      return null;
    }
  }

  async handleSetupCommand(userPhone, message, res) {
    const args = message.slice('/setup'.length).trim();
    
    if (!args) {
      return this.sendResponse(res, 
        "🏢 Business Setup\n\n" +
        "Format: /setup BusinessName businessType phone\n\n" +
        "Example: /setup Nairobi Salon salon +254700111001\n\n" +
        "Business types: salon, restaurant, dentist, gym, spa, barbershop"
      );
    }
    
    const parts = args.split(' ');
    if (parts.length < 3) {
      return this.sendResponse(res, 
        "❌ Need: BusinessName Type Phone\n\n" +
        "Example: /setup MySalon salon +254700111001\n\n" +
        "Note: Separate with spaces"
      );
    }
    
    const name = parts.slice(0, -2).join(' '); // Business name can have spaces
    const type = parts[parts.length - 2];
    const phone = parts[parts.length - 1];
    
    const validTypes = ['salon', 'restaurant', 'dentist', 'gym', 'spa', 'barbershop', 'clinic'];
    
    if (!validTypes.includes(type.toLowerCase())) {
      return this.sendResponse(res, 
        `❌ Invalid business type: ${type}\n\n` +
        `Valid types: ${validTypes.join(', ')}`
      );
    }
    
    // Validate Kenyan phone
    if (!phone.startsWith('+254') || phone.length !== 13) {
      return this.sendResponse(res,
        `❌ Invalid Kenyan phone: ${phone}\n\n` +
        `Format: +2547XXXXXXXX (13 digits)\n` +
        `Example: +254700111001`
      );
    }
    
    try {
      // Check if business already exists with this phone
      const existing = await DatabaseService.getBusinessByPhone(phone);
      if (existing) {
        return this.sendResponse(res, 
          `📋 Business already exists:\n\n` +
          `Name: ${existing.name}\n` +
          `Type: ${existing.business_type}\n` +
          `Phone: ${existing.owner_phone}\n\n` +
          `Use /status to check your business.`
        );
      }
      
      // Check if this user already has a business
      const userBusiness = await DatabaseService.getBusinessByPhone(userPhone);
      if (userBusiness) {
        return this.sendResponse(res,
          `⚠️ You already have a business:\n\n` +
          `Name: ${userBusiness.name}\n` +
          `Phone: ${userBusiness.owner_phone}\n\n` +
          `Use /status to manage it.`
        );
      }
      
      // Create business
      const businessData = {
        name: name,
        type: type.toLowerCase(),
        phone: phone,
        timezone: 'Africa/Nairobi'
      };
      
      console.log(`Creating business:`, businessData);
      
      const newBusiness = await DatabaseService.createBusiness(businessData);
      
      return this.sendResponse(res, 
        `✅ Business Created!\n\n` +
        `📋 Details:\n` +
        `• Name: ${newBusiness.name}\n` +
        `• Type: ${newBusiness.business_type}\n` +
        `• Phone: ${newBusiness.owner_phone}\n` +
        `• Timezone: ${newBusiness.timezone}\n\n` +
        `Next steps:\n` +
        `1. Add services: /add-service Service Duration Price\n` +
        `   Example: /add-service Haircut 30 800\n\n` +
        `2. Check status: /status\n\n` +
        `3. Customers can now book!`
      );
      
    } catch (error) {
      console.error('Business setup error:', error);
      return this.sendResponse(res, 
        `❌ Error creating business:\n\n${error.message}\n\n` +
        `Please try again or check database setup.`
      );
    }
  }

  async handleAdminCommand(userPhone, message, business, res) {
    const command = message.split(' ')[0];
    const args = message.slice(command.length).trim();
    
    console.log(`👑 Admin command: ${command}`, args);
    
    switch (command) {
      case '/status':
        const bookingsCount = await this.getTodayBookingsCount(business.id);
        return this.sendResponse(res,
          `📊 Business Status\n\n` +
          `• Name: ${business.name}\n` +
          `• Type: ${business.business_type}\n` +
          `• Phone: ${business.owner_phone}\n` +
          `• Timezone: ${business.timezone}\n` +
          `• Today's bookings: ${bookingsCount}\n` +
          `• Calendar: ${business.google_calendar_credentials ? 'Connected ✅' : 'Not connected ❌'}\n\n` +
          `Commands:\n` +
          `/today - Today's bookings\n` +
          `/add-service - Add services\n` +
          `/connect-calendar - Connect Google Calendar`
        );
        
      case '/today':
        const todayBookings = await this.getTodayBookings(business.id);
        if (todayBookings.length === 0) {
          return this.sendResponse(res, "No bookings for today.");
        }
        const bookingsList = todayBookings.map(b => 
          `• ${b.service_name} - ${format(new Date(b.start_time), 'h:mm a')} (${b.customer_name || b.customer_phone})`
        ).join('\n');
        return this.sendResponse(res, 
          `📅 Today's Bookings (${todayBookings.length})\n\n${bookingsList}`
        );
        
      case '/add-service':
        if (!args) {
          return this.sendResponse(res,
            `💇 Add Service\n\n` +
            `Format: /add-service Name DurationMinutes Price\n\n` +
            `Example: /add-service Haircut 30 800\n\n` +
            `Duration in minutes, price in KES`
          );
        }
        
        const serviceParts = args.split(' ');
        if (serviceParts.length < 3) {
          return this.sendResponse(res,
            `❌ Need: Name Duration Price\n\n` +
            `Example: /add-service Haircut 30 800`
          );
        }
        
        const serviceName = serviceParts.slice(0, -2).join(' ');
        const duration = parseInt(serviceParts[serviceParts.length - 2]);
        const price = parseInt(serviceParts[serviceParts.length - 1]);
        
        if (isNaN(duration) || isNaN(price)) {
          return this.sendResponse(res,
            `❌ Invalid numbers\n\n` +
            `Duration and price must be numbers\n` +
            `Example: /add-service Haircut 30 800`
          );
        }
        
        try {
          const { data: service, error } = await DatabaseService.supabase
            .from('services')
            .insert({
              business_id: business.id,
              name: serviceName,
              duration_minutes: duration,
              price: price,
              is_active: true
            })
            .select()
            .single();
          
          if (error) throw error;
          
          return this.sendResponse(res,
            `✅ Service Added!\n\n` +
            `• ${service.name}\n` +
            `• Duration: ${service.duration_minutes} minutes\n` +
            `• Price: KES ${service.price}\n\n` +
            `Customers can now book this service!`
          );
        } catch (error) {
          console.error('Add service error:', error);
          return this.sendResponse(res,
            `❌ Error adding service: ${error.message}`
          );
        }
        
      case '/help':
        return this.sendResponse(res,
          `🤖 RSRVFLOW Admin Commands\n\n` +
          `🏢 Business Setup:\n` +
          `/setup - Create business profile\n` +
          `/status - Business status\n\n` +
          `📅 Operations:\n` +
          `/today - Today's bookings\n` +
          `/add-service - Add services\n\n` +
          `⚙️ Configuration:\n` +
          `/connect-calendar - Connect Google Calendar\n\n` +
          `❓ For customers: Just chat naturally!\n` +
          `Example: "Book a haircut tomorrow at 2pm"`
        );
        
      default:
        return this.sendResponse(res, 
          `Unknown command: ${command}\n\n` +
          `Use /help for available commands.`
        );
    }
  }

  async getTodayBookingsCount(businessId) {
    try {
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
      
      if (error) {
        console.error('Error counting bookings:', error);
        return 0;
      }
      
      return count || 0;
    } catch (error) {
      console.error('Error in getTodayBookingsCount:', error);
      return 0;
    }
  }

  async getTodayBookings(businessId) {
    try {
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
      
      if (error) {
        console.error('Error getting bookings:', error);
        return [];
      }
      
      return data || [];
    } catch (error) {
      console.error('Error in getTodayBookings:', error);
      return [];
    }
  }

  sendResponse(res, message) {
    console.log(`📤 Sending response: ${message.substring(0, 100)}...`);
    
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(message);
    
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  }
}

// Create instance
const webhookHandler = new WebhookHandler();

// Export the instance's method
module.exports = {
  handleIncomingMessage: (req, res) => webhookHandler.handleIncomingMessage(req, res)
};