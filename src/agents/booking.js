const { format, parseISO, addMinutes, isSameDay, isAfter } = require('date-fns');
const DatabaseService = require('../services/supabase');
const GoogleCalendarService = require('../services/calendar');
const TwilioService = require('../services/twilio');

class BookingAgent {
  constructor(business) {
    this.business = business;
  }

  async processBooking(bookingData, conversation, customerPhone) {
    console.log('🔍 Processing booking request...', bookingData);
    try {
      console.log('Processing booking with data:', bookingData);
      
      // Validate required data
      const validation = this.validateBookingData(bookingData);
      if (!validation.valid) {
        return {
          success: false,
          message: validation.message
        };
      }
      
      // Parse date and time
      const parsedDateTime = await this.parseDateTime(bookingData.date, bookingData.time);
      if (!parsedDateTime.date || !parsedDateTime.time) {
        return {
          success: false,
          message: "I couldn't understand the date or time. Please specify clearly, e.g., 'tomorrow at 3pm' or 'next Tuesday at 2:30'."
        };
      }
      
      // Get service duration
      const serviceDuration = await this.getServiceDuration(bookingData.service);
      if (!serviceDuration) {
        return {
          success: false,
          message: `Service "${bookingData.service}" not found. Available services: ${await this.getAvailableServicesList()}`
        };
      }
      
      // Create start and end times
      const startTime = new Date(`${parsedDateTime.date}T${parsedDateTime.time}`);
      const endTime = addMinutes(startTime, serviceDuration);
      
      // Check availability
      const availability = await this.checkAvailability(
        startTime,
        endTime,
        bookingData.service,
        serviceDuration
      );
      
      if (!availability.available) {
        return {
          success: false,
          message: `Sorry, ${availability.reason}. ${availability.suggestions ? `Available times: ${availability.suggestions.join(', ')}` : 'Please choose another time.'}`
        };
      }
      
      // Create booking in database
      const booking = await this.createDatabaseBooking({
        businessId: this.business.id,
        customerPhone,
        customerName: bookingData.customer_name || null,
        serviceName: bookingData.service,
        startTime,
        endTime,
        notes: bookingData.notes,
        partySize: bookingData.party_size
      });
      
      // Add to Google Calendar if connected
      let calendarResult = null;
      if (this.business.google_calendar_credentials) {
        calendarResult = await this.addToGoogleCalendar(booking, {
          service: bookingData.service,
          customerName: bookingData.customer_name,
          customerPhone,
          notes: bookingData.notes
        });
        
        if (calendarResult.success) {
          // Update booking with calendar event ID
          await DatabaseService.updateCalendarEventId(
            booking.id,
            calendarResult.eventId,
            calendarResult.eventLink
          );
        }
      }
      
      // Send confirmation
      const confirmationMessage = this.generateConfirmationMessage(booking, calendarResult);
      await TwilioService.sendConfirmation(customerPhone, {
        id: booking.id,
        service: bookingData.service,
        date: format(startTime, 'MMM dd, yyyy'),
        time: format(startTime, 'h:mm a'),
        location: this.business.address || ''
      });
      
      // Also notify business owner
      if (this.business.owner_phone) {
        await this.notifyBusinessOwner(booking, customerPhone);
      }
      
      return {
        success: true,
        message: confirmationMessage,
        bookingId: booking.id,
        booking,
        calendarEventId: calendarResult?.eventId,
        calendarLink: calendarResult?.eventLink
      };
      
    } catch (error) {
      console.error('Booking agent error:', error);
      return {
        success: false,
        message: "I encountered an error while processing your booking. Please try again or contact us directly."
      };
    }
  }

  validateBookingData(data) {
    const missing = [];
    
    if (!data.service) missing.push('service');
    if (!data.date) missing.push('date');
    if (!data.time) missing.push('time');
    
    if (missing.length > 0) {
      return {
        valid: false,
        message: `I need a few more details to book your appointment: ${missing.join(', ')}. Can you provide these?`
      };
    }
    
    // Check if date is in the past
    const now = new Date();
    const bookingDate = new Date(`${data.date}T${data.time}`);
    if (bookingDate < now) {
      return {
        valid: false,
        message: "You can't book appointments in the past. Please choose a future date and time."
      };
    }
    
    return { valid: true };
  }

  async parseDateTime(dateStr, timeStr) {
    // Simple date parsing - in production you'd use a library like chrono-node
    let date = null;
    let time = null;
    
    // Parse date
    if (dateStr.includes('today')) {
      date = new Date().toISOString().split('T')[0];
    } else if (dateStr.includes('tomorrow')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      date = tomorrow.toISOString().split('T')[0];
    } else {
      // Try to parse as YYYY-MM-DD
      const dateMatch = dateStr.match(/\d{4}-\d{2}-\d{2}/);
      if (dateMatch) {
        date = dateMatch[0];
      }
    }
    
    // Parse time
    const timeMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toLowerCase();
      
      if (period === 'pm' && hours < 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;
      
      time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
    
    return { date, time };
  }

  async getServiceDuration(serviceName) {
    const services = await DatabaseService.getServices(this.business.id);
    const service = services.find(s => 
      s.name.toLowerCase().includes(serviceName.toLowerCase()) ||
      serviceName.toLowerCase().includes(s.name.toLowerCase())
    );
    
    return service?.duration_minutes || null;
  }

  async getAvailableServicesList() {
    const services = await DatabaseService.getServices(this.business.id);
    return services.map(s => s.name).join(', ');
  }

  async checkAvailability(startTime, endTime, serviceName, duration) {
    // Check business hours
    const dayOfWeek = format(startTime, 'EEE').toLowerCase();
    const businessHours = this.business.config?.hours?.[dayOfWeek];
    
    if (!businessHours || businessHours === 'closed') {
      return {
        available: false,
        reason: `we're closed on ${format(startTime, 'EEEE')}`
      };
    }
    
    const [openTime, closeTime] = businessHours.split('-');
    const openDateTime = new Date(startTime);
    const [openHour, openMinute] = openTime.split(':').map(Number);
    openDateTime.setHours(openHour, openMinute, 0, 0);
    
    const closeDateTime = new Date(startTime);
    const [closeHour, closeMinute] = closeTime.split(':').map(Number);
    closeDateTime.setHours(closeHour, closeMinute, 0, 0);
    
    if (startTime < openDateTime || endTime > closeDateTime) {
      return {
        available: false,
        reason: `that time is outside our business hours (${businessHours})`
      };
    }
    
    // Check Google Calendar if connected
    if (this.business.google_calendar_credentials) {
      const calendarAvailability = await GoogleCalendarService.checkAvailability(
        this.business.id,
        startTime,
        endTime
      );
      
      if (!calendarAvailability.available) {
        // Get alternative slots
        const slots = await GoogleCalendarService.getAvailableSlots(
          this.business.id,
          startTime,
          duration
        );
        
        const suggestions = slots.slots?.slice(0, 3).map(s => s.formatted) || [];
        
        return {
          available: false,
          reason: 'that time slot is already booked',
          suggestions
        };
      }
    }
    
    // Check database for conflicts
    const startOfDay = new Date(startTime);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(startTime);
    endOfDay.setHours(23, 59, 59, 999);
    
    const existingBookings = await DatabaseService.getBookingsByBusiness(
      this.business.id,
      startOfDay,
      endOfDay
    );
    
    for (const existing of existingBookings) {
      const existingStart = new Date(existing.start_time);
      const existingEnd = new Date(existing.end_time);
      
      if (
        (startTime >= existingStart && startTime < existingEnd) ||
        (endTime > existingStart && endTime <= existingEnd) ||
        (startTime <= existingStart && endTime >= existingEnd)
      ) {
        return {
          available: false,
          reason: 'that time slot is already booked'
        };
      }
    }
    
    // Check buffer time
    const bufferMinutes = this.business.config?.settings?.buffer_minutes || 15;
    if (bufferMinutes > 0) {
      const bufferStart = addMinutes(startTime, -bufferMinutes);
      const bufferEnd = addMinutes(endTime, bufferMinutes);
      
      for (const existing of existingBookings) {
        const existingStart = new Date(existing.start_time);
        const existingEnd = new Date(existing.end_time);
        
        if (
          (bufferStart < existingEnd && bufferStart > existingStart) ||
          (bufferEnd > existingStart && bufferEnd < existingEnd)
        ) {
          return {
            available: false,
            reason: 'we need buffer time between appointments'
          };
        }
      }
    }
    
    return {
      available: true,
      startTime,
      endTime,
      duration
    };
  }

  async createDatabaseBooking(bookingData) {
    return await DatabaseService.createBooking({
      business_id: bookingData.businessId,
      customer_phone: bookingData.customerPhone,
      customer_name: bookingData.customerName,
      service_name: bookingData.serviceName,
      start_time: bookingData.startTime.toISOString(),
      end_time: bookingData.endTime.toISOString(),
      notes: bookingData.notes,
      party_size: bookingData.partySize
    });
  }

  async addToGoogleCalendar(booking, details) {
    if (!this.business.google_calendar_credentials) {
      return { success: false, error: 'Calendar not configured' };
    }
    
    try {
      const result = await GoogleCalendarService.createBookingEvent(
        this.business.id,
        {
          bookingId: booking.id,
          service: booking.service_name,
          customerName: booking.customer_name || details.customerName,
          customerPhone: booking.customer_phone,
          startTime: new Date(booking.start_time),
          endTime: new Date(booking.end_time),
          notes: details.notes,
          businessId: this.business.id
        }
      );
      
      return result;
    } catch (error) {
      console.error('Failed to add to Google Calendar:', error);
      return { success: false, error: error.message };
    }
  }

  generateConfirmationMessage(booking, calendarResult) {
    const startTime = new Date(booking.start_time);
    const formattedDate = format(startTime, 'EEEE, MMMM do yyyy');
    const formattedTime = format(startTime, 'h:mm a');
    
    let message = `✅ *Booking Confirmed!*\n\n`;
    message += `📋 *Details:*\n`;
    message += `• Service: ${booking.service_name}\n`;
    message += `• Date: ${formattedDate}\n`;
    message += `• Time: ${formattedTime}\n`;
    
    if (booking.customer_name) {
      message += `• Name: ${booking.customer_name}\n`;
    }
    
    if (booking.notes) {
      message += `• Notes: ${booking.notes}\n`;
    }
    
    message += `• Booking ID: ${booking.id}\n\n`;
    
    if (calendarResult?.eventLink) {
      message += `📅 *Added to calendar:* ${calendarResult.eventLink}\n\n`;
    }
    
    message += `📍 *Location:* ${this.business.address || 'Will be confirmed via WhatsApp'}\n\n`;
    message += `ℹ️ *Important:*\n`;
    message += `• Please arrive 5-10 minutes early\n`;
    message += `• Cancellations: 24 hours notice required\n`;
    message += `• To reschedule: Reply RESCHEDULE\n`;
    message += `• To cancel: Reply CANCEL\n\n`;
    message += `Thank you for choosing ${this.business.name}!`;
    
    return message;
  }

  async notifyBusinessOwner(booking, customerPhone) {
    const startTime = new Date(booking.start_time);
    const message = `📥 New Booking!\n\n` +
      `Service: ${booking.service_name}\n` +
      `Customer: ${booking.customer_name || customerPhone}\n` +
      `Date: ${format(startTime, 'MMM dd, yyyy')}\n` +
      `Time: ${format(startTime, 'h:mm a')}\n` +
      `Booking ID: ${booking.id}`;
    
    await TwilioService.sendMessage(this.business.owner_phone, message);
  }

  async rescheduleBooking(bookingId, newDateTime, conversation) {
    try {
      const booking = await DatabaseService.getBookingById(bookingId);
      if (!booking) {
        return { success: false, message: 'Booking not found' };
      }
      
      const duration = (new Date(booking.end_time) - new Date(booking.start_time)) / (1000 * 60);
      const newEndTime = addMinutes(newDateTime, duration);
      
      // Check availability for new time
      const availability = await this.checkAvailability(
        newDateTime,
        newEndTime,
        booking.service_name,
        duration
      );
      
      if (!availability.available) {
        return { success: false, message: `Cannot reschedule: ${availability.reason}` };
      }
      
      // Update booking in database
      const { data: updatedBooking } = await DatabaseService.supabase
        .from('bookings')
        .update({
          start_time: newDateTime.toISOString(),
          end_time: newEndTime.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId)
        .select()
        .single();
      
      // Update Google Calendar if connected
      if (booking.google_calendar_event_id && this.business.google_calendar_credentials) {
        await GoogleCalendarService.updateBookingEvent(
          this.business.id,
          bookingId,
          newDateTime,
          newEndTime
        );
      }
      
      // Notify customer
      await TwilioService.sendMessage(
        booking.customer_phone,
        `✅ Booking rescheduled to ${format(newDateTime, 'EEEE, MMMM do')} at ${format(newDateTime, 'h:mm a')}`
      );
      
      return {
        success: true,
        message: `Booking rescheduled to ${format(newDateTime, 'EEEE, MMMM do')} at ${format(newDateTime, 'h:mm a')}`,
        booking: updatedBooking
      };
      
    } catch (error) {
      console.error('Reschedule error:', error);
      return { success: false, message: 'Failed to reschedule booking' };
    }
  }

  async cancelBooking(bookingId, reason) {
    try {
      const booking = await DatabaseService.getBookingById(bookingId);
      if (!booking) {
        return { success: false, message: 'Booking not found' };
      }
      
      // Update booking status
      const updatedBooking = await DatabaseService.updateBookingStatus(
        bookingId,
        'cancelled',
        reason
      );
      
      // Cancel Google Calendar event if exists
      if (booking.google_calendar_event_id && this.business.google_calendar_credentials) {
        await GoogleCalendarService.cancelBookingEvent(
          this.business.id,
          bookingId,
          reason
        );
      }
      
      // Notify customer
      await TwilioService.sendCancellation(booking.customer_phone, {
        service: booking.service_name,
        date: format(new Date(booking.start_time), 'MMM dd, yyyy'),
        refund: '' // Add refund logic if needed
      });
      
      return {
        success: true,
        message: `Booking cancelled${reason ? `: ${reason}` : ''}`,
        booking: updatedBooking
      };
      
    } catch (error) {
      console.error('Cancel error:', error);
      return { success: false, message: 'Failed to cancel booking' };
    }
  }
}

module.exports = BookingAgent;