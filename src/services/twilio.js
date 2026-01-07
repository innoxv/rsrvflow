const twilio = require('twilio');
const config = require('../config');

class TwilioService {
  constructor() {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
    this.whatsappNumber = config.twilio.whatsappNumber;
  }

  async sendMessage(to, body, mediaUrl = null) {
    try {
      const message = {
        from: this.whatsappNumber,
        to: `whatsapp:${to}`,
        body: body
      };

      if (mediaUrl) {
        message.mediaUrl = mediaUrl;
      }

      const response = await this.client.messages.create(message);
      console.log(`📤 Sent message to ${to}: ${body.substring(0, 50)}...`);
      return response;
    } catch (error) {
      console.error('Twilio send error:', error);
      throw error;
    }
  }

  async sendTemplateMessage(to, templateName, parameters = {}) {
    // For WhatsApp template messages (business accounts)
    try {
      const response = await this.client.messages.create({
        from: this.whatsappNumber,
        to: `whatsapp:${to}`,
        contentSid: templateName, // Template SID from Twilio
        contentVariables: JSON.stringify(parameters)
      });
      
      return response;
    } catch (error) {
      console.error('Template message error:', error);
      throw error;
    }
  }

  async sendReminder(to, bookingDetails) {
    const message = `🔔 Reminder: Your ${bookingDetails.service} appointment is tomorrow at ${bookingDetails.time}. Location: ${bookingDetails.location || 'See details'}. Reply CANCEL to reschedule.`;
    
    return this.sendMessage(to, message);
  }

  async sendConfirmation(to, bookingDetails) {
    const message = `✅ Confirmed: ${bookingDetails.service} on ${bookingDetails.date} at ${bookingDetails.time}. Booking ID: ${bookingDetails.id}. Reply HELP for assistance.`;
    
    return this.sendMessage(to, message);
  }

  async sendCancellation(to, bookingDetails) {
    const message = `❌ Cancelled: Your ${bookingDetails.service} appointment on ${bookingDetails.date} has been cancelled. ${bookingDetails.refund ? `Refund: ${bookingDetails.refund}` : ''}`;
    
    return this.sendMessage(to, message);
  }

  // Validate incoming webhook signature
  validateWebhookSignature(req) {
    const twilioSignature = req.headers['x-twilio-signature'];
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const params = req.body;
    
    return twilio.validateRequest(
      config.twilio.authToken,
      twilioSignature,
      url,
      params
    );
  }
}

module.exports = new TwilioService();