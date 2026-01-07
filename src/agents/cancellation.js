const DatabaseService = require('../services/supabase');
const TwilioService = require('../services/twilio');
const { format } = require('date-fns');

class CancellationAgent {
  constructor(business) {
    this.business = business;
  }

  async handleCancellationRequest(customerPhone, reason = '') {
    try {
      // Get customer's upcoming bookings
      const bookings = await DatabaseService.getBookingsByCustomer(customerPhone, this.business.id);
      
      if (bookings.length === 0) {
        return {
          success: false,
          message: "You don't have any upcoming bookings to cancel."
        };
      }
      
      if (bookings.length === 1) {
        // Auto-cancel the single booking
        return await this.processCancellation(bookings[0].id, reason);
      }
      
      // Multiple bookings - ask which one
      const bookingOptions = bookings.map((booking, index) => {
        const startTime = new Date(booking.start_time);
        return {
          number: index + 1,
          id: booking.id,
          service: booking.service_name,
          date: format(startTime, 'MMM dd, yyyy'),
          time: format(startTime, 'h:mm a')
        };
      });
      
      const optionsText = bookingOptions.map(opt => 
        `${opt.number}. ${opt.service} on ${opt.date} at ${opt.time}`
      ).join('\n');
      
      return {
        success: false,
        needsSelection: true,
        message: `You have multiple bookings. Which one would you like to cancel?\n\n${optionsText}\n\nReply with the number.`,
        bookings: bookingOptions
      };
      
    } catch (error) {
      console.error('Cancellation request error:', error);
      return {
        success: false,
        message: "I encountered an error processing your cancellation request. Please try again."
      };
    }
  }

  async processCancellation(bookingId, reason = '') {
    try {
      const booking = await DatabaseService.getBookingById(bookingId);
      if (!booking) {
        return {
          success: false,
          message: "Booking not found."
        };
      }
      
      // Check if cancellation is within policy
      const cancellationAllowed = await this.checkCancellationPolicy(booking);
      if (!cancellationAllowed.allowed) {
        return {
          success: false,
          message: cancellationAllowed.message
        };
      }
      
      // Update booking status
      const updatedBooking = await DatabaseService.updateBookingStatus(
        bookingId,
        'cancelled',
        reason
      );
      
      // Notify customer
      await this.sendCancellationConfirmation(booking, reason);
      
      // Notify business owner
      await this.notifyBusinessOwner(booking, reason);
      
      return {
        success: true,
        message: this.generateCancellationMessage(booking, reason),
        booking: updatedBooking,
        fee: cancellationAllowed.fee
      };
      
    } catch (error) {
      console.error('Cancellation processing error:', error);
      return {
        success: false,
        message: "Failed to process cancellation. Please contact us directly."
      };
    }
  }

  async checkCancellationPolicy(booking) {
    const startTime = new Date(booking.start_time);
    const now = new Date();
    const hoursDifference = (startTime - now) / (1000 * 60 * 60);
    
    const policyHours = this.business.config?.settings?.cancellation_hours || 24;
    const lateFee = this.business.config?.settings?.late_cancellation_fee || 0;
    
    if (hoursDifference < policyHours) {
      return {
        allowed: true,
        fee: lateFee,
        message: lateFee > 0 ? 
          `Late cancellation. A fee of $${lateFee} may apply.` :
          'Late cancellation noted.'
      };
    }
    
    return {
      allowed: true,
      fee: 0,
      message: 'Cancellation within policy.'
    };
  }

  async sendCancellationConfirmation(booking, reason) {
    const startTime = new Date(booking.start_time);
    const message = `❌ *Cancellation Confirmed*\n\n` +
      `Your booking has been cancelled:\n\n` +
      `• Service: ${booking.service_name}\n` +
      `• Date: ${format(startTime, 'MMM dd, yyyy')}\n` +
      `• Time: ${format(startTime, 'h:mm a')}\n` +
      `${reason ? `• Reason: ${reason}\n` : ''}\n` +
      `We hope to serve you again soon!`;
    
    await TwilioService.sendMessage(booking.customer_phone, message);
  }

  async notifyBusinessOwner(booking, reason) {
    const startTime = new Date(booking.start_time);
    const message = `❌ Booking Cancelled\n\n` +
      `Service: ${booking.service_name}\n` +
      `Customer: ${booking.customer_name || booking.customer_phone}\n` +
      `Original Time: ${format(startTime, 'MMM dd, yyyy')} at ${format(startTime, 'h:mm a')}\n` +
      `Reason: ${reason || 'Not specified'}\n` +
      `Booking ID: ${booking.id}`;
    
    if (this.business.owner_phone) {
      await TwilioService.sendMessage(this.business.owner_phone, message);
    }
  }

  generateCancellationMessage(booking, reason) {
    const startTime = new Date(booking.start_time);
    
    let message = `✅ *Cancellation Successful*\n\n` +
      `Your booking has been cancelled:\n\n` +
      `• Service: ${booking.service_name}\n` +
      `• Date: ${format(startTime, 'MMM dd, yyyy')}\n` +
      `• Time: ${format(startTime, 'h:mm a')}\n`;
    
    if (reason) {
      message += `• Reason: ${reason}\n`;
    }
    
    message += `\nWe're sorry to see you go! `;
    message += `If you'd like to book another appointment, just let me know.`;
    
    return message;
  }

  async handleRescheduleRequest(customerPhone, newDateTime) {
    try {
      const bookings = await DatabaseService.getBookingsByCustomer(customerPhone, this.business.id);
      
      if (bookings.length === 0) {
        return {
          success: false,
          message: "You don't have any bookings to reschedule."
        };
      }
      
      if (bookings.length === 1) {
        return {
          success: true,
          needsConfirmation: true,
          message: `Would you like to reschedule your ${bookings[0].service_name} appointment to ${format(newDateTime, 'EEEE, MMMM do')} at ${format(newDateTime, 'h:mm a')}? Reply YES to confirm.`,
          bookingId: bookings[0].id,
          newDateTime
        };
      }
      
      // Multiple bookings - need to specify which one
      return {
        success: false,
        needsSelection: true,
        message: "You have multiple bookings. Please specify which appointment you'd like to reschedule.",
        bookings: bookings.map(b => ({
          id: b.id,
          service: b.service_name,
          time: format(new Date(b.start_time), 'MMM dd, h:mm a')
        }))
      };
      
    } catch (error) {
      console.error('Reschedule request error:', error);
      return {
        success: false,
        message: "Error processing reschedule request."
      };
    }
  }
}

module.exports = CancellationAgent;