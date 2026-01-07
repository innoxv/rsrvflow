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
    console.log('🟢 WEBHOOK CALLED at', new Date().toISOString());
    
    try {
      // TEMPORARILY DISABLE SIGNATURE VALIDATION
      // if (process.env.NODE_ENV === 'production') {
      //   const isValid = TwilioService.validateWebhookSignature(req);
      //   if (!isValid) {
      //     console.error('Invalid Twilio signature');
      //     return res.status(403).send('Invalid signature');
      //   }
      // }

      const userPhone = req.body.From ? req.body.From.replace('whatsapp:', '') : 'unknown';
      const message = req.body.Body ? req.body.Body.trim() : '';
      
      console.log(`📱 From: ${userPhone}, Message: "${message}"`);
      
      // SIMPLE TEST RESPONSE
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
      
      // Determine business context
      const business = await this.determineBusiness(userPhone);
      if (!business) {
        return this.sendResponse(res, "I couldn't find a business associated with this number. Please contact the business directly or use /setup to create one.");
      }
      
      console.log(`🏢 Using business: ${business.name} (${business.business_type})`);
      
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
        "For immediate help, please contact the business directly."
      );
    }
  }

  async determineBusiness(userPhone) {
    // First check if user is a business owner
    const business = await DatabaseService.getBusinessByPhone(userPhone);
    if (business) {
      return business;
    }
    
    // For customers: Use first business for now
    const { data: businesses } = await DatabaseService.supabase
      .from('businesses')
      .select('*')
      .limit(1);
    
    return businesses?.[0] || null;
  }

  sendResponse(res, message) {
    console.log(`📤 Sending response: ${message.substring(0, 100)}...`);
    
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(message);
    
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  }
}

module.exports = new WebhookHandler();