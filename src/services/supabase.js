const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

if (!config.supabase.url || !config.supabase.key) {
  throw new Error('Missing Supabase configuration');
}

const supabase = createClient(config.supabase.url, config.supabase.key);

class DatabaseService {
  // Business Management
  async getBusinessById(id) {
    const { data, error } = await supabase
      .from('businesses')
      .select(`
        *,
        services (*),
        availability_exceptions (*)
      `)
      .eq('id', id)
      .single();
    
    if (error) {
      console.error('Error getting business:', error);
      return null;
    }
    
    return data;
  }

  async getBusinessByPhone(phone) {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_phone', phone)
      .maybeSingle();
    
    if (error) {
      console.error('Error getting business by phone:', error);
      return null;
    }
    
    return data;
  }

  async createBusiness(businessData) {
    const { data, error } = await supabase
      .from('businesses')
      .insert([{
        name: businessData.name,
        business_type: businessData.type,
        owner_phone: businessData.phone,
        timezone: businessData.timezone || config.timezone,
        config: businessData.config || this.getDefaultConfig(businessData.type),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (error) {
      console.error('Error creating business:', error);
      throw error;
    }
    
    // Create default services
    await this.createDefaultServices(data.id, businessData.type);
    
    return data;
  }

  async updateBusinessConfig(businessId, configUpdates) {
    const { data, error } = await supabase
      .from('businesses')
      .update({
        config: configUpdates,
        updated_at: new Date().toISOString()
      })
      .eq('id', businessId)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating business config:', error);
      throw error;
    }
    
    return data;
  }

  async updateGoogleCalendarCredentials(businessId, credentials) {
    const { data, error } = await supabase
      .from('businesses')
      .update({
        google_calendar_credentials: credentials,
        updated_at: new Date().toISOString()
      })
      .eq('id', businessId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // Services Management
  async getServices(businessId) {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name');
    
    if (error) {
      console.error('Error getting services:', error);
      return [];
    }
    
    return data;
  }

  async createDefaultServices(businessId, businessType) {
    const defaultServices = {
      salon: [
        { name: 'Haircut', duration_minutes: 30, price: 25 },
        { name: 'Hair Color', duration_minutes: 90, price: 80 },
        { name: 'Styling', duration_minutes: 45, price: 35 }
      ],
      barbershop: [
        { name: 'Haircut', duration_minutes: 30, price: 20 },
        { name: 'Beard Trim', duration_minutes: 15, price: 10 },
        { name: 'Shave', duration_minutes: 30, price: 25 }
      ],
      dentist: [
        { name: 'Cleaning', duration_minutes: 45, price: 80 },
        { name: 'Check-up', duration_minutes: 30, price: 60 },
        { name: 'Filling', duration_minutes: 60, price: 150 }
      ],
      restaurant: [
        { name: 'Table for 2', duration_minutes: 90, price: 0 },
        { name: 'Table for 4', duration_minutes: 90, price: 0 },
        { name: 'Table for 6', duration_minutes: 120, price: 0 }
      ]
    };

    const services = defaultServices[businessType] || defaultServices.salon;
    
    for (const service of services) {
      await supabase
        .from('services')
        .insert({
          business_id: businessId,
          ...service,
          is_active: true
        });
    }
  }

  // Bookings Management
  async createBooking(bookingData) {
    const { data, error } = await supabase
      .from('bookings')
      .insert([{
        business_id: bookingData.business_id,
        customer_phone: bookingData.customer_phone,
        customer_name: bookingData.customer_name,
        service_id: bookingData.service_id,
        service_name: bookingData.service_name,
        start_time: bookingData.start_time,
        end_time: bookingData.end_time,
        status: 'confirmed',
        notes: bookingData.notes,
        google_calendar_event_id: bookingData.google_calendar_event_id,
        google_calendar_link: bookingData.google_calendar_link,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (error) {
      console.error('Error creating booking:', error);
      throw error;
    }
    
    return data;
  }

  async getBookingById(id) {
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        *,
        businesses (*)
      `)
      .eq('id', id)
      .single();
    
    if (error) {
      console.error('Error getting booking:', error);
      return null;
    }
    
    return data;
  }

  async getBookingsByCustomer(phone, businessId = null) {
    let query = supabase
      .from('bookings')
      .select(`
        *,
        businesses (*)
      `)
      .eq('customer_phone', phone)
      .eq('status', 'confirmed')
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true });
    
    if (businessId) {
      query = query.eq('business_id', businessId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error getting customer bookings:', error);
      return [];
    }
    
    return data;
  }

  async getBookingsByBusiness(businessId, startDate, endDate) {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'confirmed')
      .gte('start_time', startDate.toISOString())
      .lte('start_time', endDate.toISOString())
      .order('start_time', { ascending: true });
    
    if (error) {
      console.error('Error getting business bookings:', error);
      return [];
    }
    
    return data;
  }

  async updateBookingStatus(bookingId, status, reason = null) {
    const updates = {
      status,
      updated_at: new Date().toISOString()
    };
    
    if (reason) {
      updates.cancellation_reason = reason;
    }
    
    const { data, error } = await supabase
      .from('bookings')
      .update(updates)
      .eq('id', bookingId)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating booking status:', error);
      throw error;
    }
    
    return data;
  }

  async updateCalendarEventId(bookingId, eventId, eventLink = null) {
    const updates = {
      google_calendar_event_id: eventId,
      updated_at: new Date().toISOString()
    };
    
    if (eventLink) {
      updates.google_calendar_link = eventLink;
    }
    
    const { data, error } = await supabase
      .from('bookings')
      .update(updates)
      .eq('id', bookingId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // Conversation Management
  async getOrCreateConversation(phone, businessId) {
    // Try to find existing conversation
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .eq('phone_number', phone)
      .eq('business_id', businessId)
      .single();
    
    if (existing) {
      return existing;
    }
    
    // Create new conversation
    const { data: newConv, error } = await supabase
      .from('conversations')
      .insert([{
        phone_number: phone,
        business_id: businessId,
        history: [],
        current_state: 'idle',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
    
    return newConv;
  }

  async updateConversation(conversationId, updates) {
    const { data, error } = await supabase
      .from('conversations')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async addMessageToHistory(conversationId, role, content) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('history')
      .eq('id', conversationId)
      .single();
    
    const newHistory = [
      ...(conv.history || []),
      {
        role,
        content,
        timestamp: new Date().toISOString()
      }
    ];
    
    // Keep only last 20 messages
    const trimmedHistory = newHistory.slice(-20);
    
    const { data, error } = await supabase
      .from('conversations')
      .update({
        history: trimmedHistory,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // Availability & Exceptions
  async getAvailabilityExceptions(businessId, date) {
    const { data, error } = await supabase
      .from('availability_exceptions')
      .select('*')
      .eq('business_id', businessId)
      .eq('date', date)
      .or('type.eq.holiday,type.eq.blackout,type.eq.time_off');
    
    if (error) return [];
    return data;
  }

  async getUpcomingReminders(hoursBefore = 24) {
    const reminderTime = new Date();
    reminderTime.setHours(reminderTime.getHours() + hoursBefore);
    
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        *,
        businesses (name, owner_phone)
      `)
      .eq('status', 'confirmed')
      .eq('reminder_sent', false)
      .gte('start_time', new Date().toISOString())
      .lte('start_time', reminderTime.toISOString());
    
    if (error) {
      console.error('Error getting reminders:', error);
      return [];
    }
    
    return data;
  }

  async markReminderSent(bookingId) {
    await supabase
      .from('bookings')
      .update({
        reminder_sent: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId);
  }

  // Helper Methods
  getDefaultConfig(businessType) {
    const baseConfig = {
      services: {},
      hours: {
        mon: '09:00-18:00',
        tue: '09:00-18:00',
        wed: '09:00-18:00',
        thu: '09:00-18:00',
        fri: '09:00-18:00',
        sat: '10:00-16:00',
        sun: 'closed'
      },
      settings: {
        buffer_minutes: 15,
        max_bookings_per_day: 30,
        advance_booking_days: 90,
        require_confirmation: false,
        cancellation_policy: '24 hours'
      }
    };

    // Type-specific adjustments
    switch (businessType) {
      case 'restaurant':
        baseConfig.hours = {
          mon: '17:00-22:00',
          tue: '17:00-22:00',
          wed: '17:00-22:00',
          thu: '17:00-22:00',
          fri: '17:00-23:00',
          sat: '12:00-23:00',
          sun: '12:00-21:00'
        };
        baseConfig.settings.buffer_minutes = 30;
        break;
      case 'dentist':
        baseConfig.settings.buffer_minutes = 15;
        baseConfig.settings.require_confirmation = true;
        break;
      case 'barbershop':
        baseConfig.settings.buffer_minutes = 10;
        baseConfig.settings.max_bookings_per_day = 40;
        break;
    }

    return baseConfig;
  }
}

module.exports = new DatabaseService();