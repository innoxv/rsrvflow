const { google } = require('googleapis');
const { OAuth2 } = google.auth;
const DatabaseService = require('./supabase');
const config = require('../config');
const { addMinutes, format } = require('date-fns');

class GoogleCalendarService {
  constructor() {
    this.SCOPES = config.googleCalendar.scopes;
    this.calendar = null;
  }

  async initializeForBusiness(businessId) {
    try {
      const business = await DatabaseService.getBusinessById(businessId);
      
      if (!business?.google_calendar_credentials) {
        throw new Error('Google Calendar not configured for this business');
      }

      const credentials = business.google_calendar_credentials;
      
      const oAuth2Client = new OAuth2(
        config.googleCalendar.clientId,
        config.googleCalendar.clientSecret,
        config.googleCalendar.redirectUri
      );

      oAuth2Client.setCredentials({
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token,
        scope: this.SCOPES,
        token_type: 'Bearer',
        expiry_date: credentials.expiry_date
      });

      // Refresh token if expired or about to expire
      if (credentials.expiry_date && Date.now() > credentials.expiry_date - 300000) {
        try {
          const { credentials: newTokens } = await oAuth2Client.refreshAccessToken();
          oAuth2Client.setCredentials(newTokens);
          
          // Update stored tokens
          await DatabaseService.updateGoogleCalendarCredentials(businessId, {
            ...credentials,
            access_token: newTokens.access_token,
            expiry_date: newTokens.expiry_date
          });
        } catch (refreshError) {
          console.error('Failed to refresh token:', refreshError);
        }
      }

      this.calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
      return true;
      
    } catch (error) {
      console.error('Calendar initialization error:', error);
      return false;
    }
  }

  // Generate OAuth URL for business setup
  generateAuthUrl(businessId) {
    const oAuth2Client = new OAuth2(
      config.googleCalendar.clientId,
      config.googleCalendar.clientSecret,
      config.googleCalendar.redirectUri
    );

    return oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.SCOPES,
      state: JSON.stringify({ businessId }),
      prompt: 'consent',
      include_granted_scopes: true
    });
  }

  // Handle OAuth callback
  async handleOAuthCallback(code, businessId) {
    const oAuth2Client = new OAuth2(
      config.googleCalendar.clientId,
      config.googleCalendar.clientSecret,
      config.googleCalendar.redirectUri
    );

    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      // Store tokens in database
      await DatabaseService.updateGoogleCalendarCredentials(businessId, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date
      });

      // Create or use existing calendar
      const business = await DatabaseService.getBusinessById(businessId);
      if (!business.google_calendar_id) {
        await this.createBusinessCalendar(businessId, `${business.name} - Bookings`);
      }

      return tokens;
    } catch (error) {
      console.error('OAuth callback error:', error);
      throw error;
    }
  }

  // Create a new calendar for business
  async createBusinessCalendar(businessId, calendarName) {
    await this.initializeForBusiness(businessId);

    try {
      const response = await this.calendar.calendars.insert({
        requestBody: {
          summary: calendarName,
          description: `Booking calendar for ${calendarName} managed by WhatsApp Booking Bot`,
          timeZone: config.timezone
        }
      });

      // Store calendar ID
      await DatabaseService.supabase
        .from('businesses')
        .update({
          google_calendar_id: response.data.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', businessId);

      return {
        success: true,
        calendarId: response.data.id,
        calendar: response.data
      };
    } catch (error) {
      console.error('Calendar creation error:', error);
      return { success: false, error: error.message };
    }
  }

  // Check availability for a time slot
  async checkAvailability(businessId, startTime, endTime) {
    const initialized = await this.initializeForBusiness(businessId);
    if (!initialized) {
      return { available: false, error: 'Calendar not initialized' };
    }

    const business = await DatabaseService.getBusinessById(businessId);
    const calendarId = business.google_calendar_id || 'primary';

    try {
      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: startTime.toISOString(),
          timeMax: endTime.toISOString(),
          timeZone: config.timezone,
          items: [{ id: calendarId }]
        }
      });

      const busySlots = response.data.calendars[calendarId]?.busy || [];
      const available = busySlots.length === 0;

      return {
        available,
        busySlots,
        calendarId
      };
    } catch (error) {
      console.error('Availability check error:', error);
      return { available: false, error: error.message };
    }
  }

  // Create booking event
  async createBookingEvent(businessId, bookingDetails) {
    const initialized = await this.initializeForBusiness(businessId);
    if (!initialized) {
      return { success: false, error: 'Calendar not initialized' };
    }

    const business = await DatabaseService.getBusinessById(businessId);
    const calendarId = business.google_calendar_id || 'primary';

    const event = {
      summary: `${bookingDetails.service} - ${bookingDetails.customerName || 'Customer'}`,
      location: bookingDetails.location || '',
      description: this.generateEventDescription(bookingDetails),
      start: {
        dateTime: bookingDetails.startTime.toISOString(),
        timeZone: config.timezone
      },
      end: {
        dateTime: bookingDetails.endTime.toISOString(),
        timeZone: config.timezone
      },
      attendees: [
        { email: business.email || '', organizer: true, responseStatus: 'accepted' },
        { 
          email: `${bookingDetails.customerPhone}@whatsapp.customer`, 
          displayName: bookingDetails.customerName || 'Customer'
        }
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'email', minutes: 24 * 60 }
        ]
      },
      extendedProperties: {
        private: {
          bookingId: bookingDetails.bookingId,
          businessId: businessId,
          customerPhone: bookingDetails.customerPhone,
          source: 'whatsapp-booking-bot'
        }
      },
      source: {
        title: 'WhatsApp Booking',
        url: 'https://github.com/your-repo/whatsapp-booking-bot'
      }
    };

    try {
      const response = await this.calendar.events.insert({
        calendarId: calendarId,
        resource: event,
        sendUpdates: 'all',
        conferenceDataVersion: 1
      });

      return {
        success: true,
        eventId: response.data.id,
        eventLink: response.data.htmlLink,
        hangoutLink: response.data.hangoutLink,
        event: response.data
      };
    } catch (error) {
      console.error('Event creation error:', error);
      return { success: false, error: error.message };
    }
  }

  // Update booking event
  async updateBookingEvent(businessId, bookingId, newStartTime, newEndTime) {
    const initialized = await this.initializeForBusiness(businessId);
    if (!initialized) {
      return { success: false, error: 'Calendar not initialized' };
    }

    const booking = await DatabaseService.getBookingById(bookingId);
    if (!booking?.google_calendar_event_id) {
      return { success: false, error: 'No calendar event found' };
    }

    const business = await DatabaseService.getBusinessById(businessId);
    const calendarId = business.google_calendar_id || 'primary';

    try {
      // First get the existing event
      const existingEvent = await this.calendar.events.get({
        calendarId: calendarId,
        eventId: booking.google_calendar_event_id
      });

      const updatedEvent = {
        ...existingEvent.data,
        start: {
          dateTime: newStartTime.toISOString(),
          timeZone: config.timezone
        },
        end: {
          dateTime: newEndTime.toISOString(),
          timeZone: config.timezone
        },
        summary: `[Rescheduled] ${existingEvent.data.summary.replace('[Rescheduled] ', '')}`
      };

      const response = await this.calendar.events.update({
        calendarId: calendarId,
        eventId: booking.google_calendar_event_id,
        resource: updatedEvent,
        sendUpdates: 'all'
      });

      return {
        success: true,
        eventId: response.data.id,
        eventLink: response.data.htmlLink
      };
    } catch (error) {
      console.error('Event update error:', error);
      return { success: false, error: error.message };
    }
  }

  // Cancel booking event
  async cancelBookingEvent(businessId, bookingId, reason = '') {
    const initialized = await this.initializeForBusiness(businessId);
    if (!initialized) {
      return { success: false, error: 'Calendar not initialized' };
    }

    const booking = await DatabaseService.getBookingById(bookingId);
    if (!booking?.google_calendar_event_id) {
      return { success: true, message: 'No calendar event to cancel' };
    }

    const business = await DatabaseService.getBusinessById(businessId);
    const calendarId = business.google_calendar_id || 'primary';

    try {
      const existingEvent = await this.calendar.events.get({
        calendarId: calendarId,
        eventId: booking.google_calendar_event_id
      });

      const cancelledEvent = {
        ...existingEvent.data,
        summary: `[CANCELLED] ${existingEvent.data.summary.replace('[CANCELLED] ', '')}`,
        description: `${existingEvent.data.description}\n\nCANCELLED: ${reason}\nCancelled at: ${new Date().toISOString()}`,
        status: 'cancelled'
      };

      await this.calendar.events.update({
        calendarId: calendarId,
        eventId: booking.google_calendar_event_id,
        resource: cancelledEvent,
        sendUpdates: 'all'
      });

      return { success: true };
    } catch (error) {
      console.error('Event cancellation error:', error);
      return { success: false, error: error.message };
    }
  }

  // Get available slots for a specific date
  async getAvailableSlots(businessId, date, serviceDuration) {
    const business = await DatabaseService.getBusinessById(businessId);
    const hours = business?.config?.hours || {};
    
    const dayOfWeek = format(date, 'EEE').toLowerCase();
    const businessHours = hours[dayOfWeek];
    
    if (!businessHours || businessHours === 'closed') {
      return { available: false, slots: [], reason: 'Closed' };
    }

    const [openTime, closeTime] = businessHours.split('-');
    const openDateTime = new Date(date);
    const [openHour, openMinute] = openTime.split(':').map(Number);
    openDateTime.setHours(openHour, openMinute, 0, 0);

    const closeDateTime = new Date(date);
    const [closeHour, closeMinute] = closeTime.split(':').map(Number);
    closeDateTime.setHours(closeHour, closeMinute, 0, 0);

    // Get existing events from calendar
    const events = await this.getDayEvents(businessId, date);
    
    // Generate slots
    const slots = [];
    let currentTime = new Date(openDateTime);
    const slotInterval = 15; // Check every 15 minutes

    while (currentTime < closeDateTime) {
      const slotEnd = new Date(currentTime.getTime() + serviceDuration * 60000);
      
      if (slotEnd <= closeDateTime) {
        const conflicts = events.some(event => {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const eventEnd = new Date(event.end.dateTime || event.end.date);
          
          return (
            (currentTime >= eventStart && currentTime < eventEnd) ||
            (slotEnd > eventStart && slotEnd <= eventEnd) ||
            (currentTime <= eventStart && slotEnd >= eventEnd)
          );
        });

        if (!conflicts) {
          slots.push({
            start: new Date(currentTime),
            end: slotEnd,
            formatted: format(currentTime, 'h:mm a'),
            duration: serviceDuration
          });
        }
      }

      currentTime = new Date(currentTime.getTime() + slotInterval * 60000);
    }

    return {
      available: slots.length > 0,
      slots,
      businessHours,
      date: format(date, 'yyyy-MM-dd')
    };
  }

  // Get events for a specific day
  async getDayEvents(businessId, date) {
    const initialized = await this.initializeForBusiness(businessId);
    if (!initialized) {
      return [];
    }

    const business = await DatabaseService.getBusinessById(businessId);
    const calendarId = business.google_calendar_id || 'primary';

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      const response = await this.calendar.events.list({
        calendarId: calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      return response.data.items || [];
    } catch (error) {
      console.error('Error fetching events:', error);
      return [];
    }
  }

  // Helper methods
  generateEventDescription(bookingDetails) {
    return `
Booking Details:
- Service: ${bookingDetails.service}
- Customer: ${bookingDetails.customerName || 'N/A'}
- Phone: ${bookingDetails.customerPhone}
- Booking ID: ${bookingDetails.bookingId}
- Notes: ${bookingDetails.notes || 'None'}

Created via WhatsApp Booking Bot
${bookingDetails.businessId ? `Business ID: ${bookingDetails.businessId}` : ''}
    `.trim();
  }

  // Test calendar connection
  async testConnection(businessId) {
    try {
      const initialized = await this.initializeForBusiness(businessId);
      if (!initialized) {
        return { connected: false, error: 'Not initialized' };
      }

      const business = await DatabaseService.getBusinessById(businessId);
      const calendarId = business.google_calendar_id || 'primary';

      // Try to get calendar metadata
      await this.calendar.calendars.get({
        calendarId: calendarId
      });

      return { connected: true, calendarId };
    } catch (error) {
      return { connected: false, error: error.message };
    }
  }
}

module.exports = new GoogleCalendarService();