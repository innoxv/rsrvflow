const twilio = require('twilio');
const config = require('../config');

class TwilioService {
  constructor() {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
    this.whatsappNumber = config.twilio.whatsappNumber;
  }

  async sendMessage(to, body, mediaUrl = null) {
    try {
      console.log(`📤 Sending to ${to}: ${body.substring(0, 50)}...`);
      
      const message = {
        from: this.whatsappNumber,
        to: `whatsapp:${to}`,
        body: body
      };

      if (mediaUrl) {
        message.mediaUrl = mediaUrl;
      }

      const response = await this.client.messages.create(message);
      console.log(`✅ Message sent: ${response.sid}`);
      return response;
    } catch (error) {
      console.error('❌ Twilio send error:', error.message);
      throw error;
    }
  }

  async sendConfirmation(to, bookingDetails) {
    const message = `✅ Confirmed: ${bookingDetails.service} on ${bookingDetails.date} at ${bookingDetails.time}. Booking ID: ${bookingDetails.id}.`;
    
    return this.sendMessage(to, message);
  }

  async sendReminder(to, bookingDetails) {
    const message = `🔔 Reminder: Your ${bookingDetails.service} appointment is tomorrow at ${bookingDetails.time}. Reply CANCEL to reschedule.`;
    
    return this.sendMessage(to, message);
  }

  async sendCancellation(to, bookingDetails) {
    const message = `❌ Cancelled: Your ${bookingDetails.service} appointment on ${bookingDetails.date} has been cancelled.`;
    
    return this.sendMessage(to, message);
  }

  // Validate webhook signature
  validateWebhookSignature(req) {
    try {
      const twilioSignature = req.headers['x-twilio-signature'];
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const params = req.body;
      
      return twilio.validateRequest(
        config.twilio.authToken,
        twilioSignature,
        url,
        params
      );
    } catch (error) {
      console.error('Signature validation error:', error);
      return false;
    }
  }
}

module.exports = new TwilioService();