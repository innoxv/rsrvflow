class Validation {
  static isValidPhone(phone) {
    // Basic international phone validation
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone.replace(/\D/g, ''));
  }

  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static isValidTime(time) {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  }

  static isValidDate(date) {
    const dateObj = new Date(date);
    return dateObj instanceof Date && !isNaN(dateObj);
  }

  static isFutureDate(date) {
    const dateObj = new Date(date);
    const now = new Date();
    return dateObj > now;
  }

  static isWithinBusinessHours(time, businessHours, dayOfWeek) {
    if (!businessHours || !businessHours[dayOfWeek] || businessHours[dayOfWeek] === 'closed') {
      return false;
    }
    
    const [openTime, closeTime] = businessHours[dayOfWeek].split('-');
    return time >= openTime && time <= closeTime;
  }

  static isValidService(serviceName, availableServices) {
    if (!serviceName || !availableServices) return false;
    
    const serviceLower = serviceName.toLowerCase();
    return availableServices.some(service => 
      service.name.toLowerCase().includes(serviceLower) ||
      serviceLower.includes(service.name.toLowerCase())
    );
  }

  static validateBookingData(data, business) {
    const errors = [];
    
    if (!data.service) {
      errors.push('Service is required');
    }
    
    if (!data.date) {
      errors.push('Date is required');
    } else if (!this.isValidDate(data.date)) {
      errors.push('Invalid date format');
    } else if (!this.isFutureDate(data.date)) {
      errors.push('Date must be in the future');
    }
    
    if (!data.time) {
      errors.push('Time is required');
    } else if (!this.isValidTime(data.time)) {
      errors.push('Invalid time format (use HH:MM)');
    }
    
    if (data.party_size && (isNaN(data.party_size) || data.party_size < 1)) {
      errors.push('Party size must be a positive number');
    }
    
    // Check business hours if date and time are provided
    if (data.date && data.time && business?.config?.hours) {
      const dayOfWeek = new Date(data.date).toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
      if (!this.isWithinBusinessHours(data.time, business.config.hours, dayOfWeek)) {
        errors.push('Time is outside business hours');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  static sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    
    // Remove potentially dangerous characters
    return input
      .replace(/[<>]/g, '') // Remove < and >
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  }

  static validateBusinessConfig(config) {
    const errors = [];
    
    if (!config.hours || typeof config.hours !== 'object') {
      errors.push('Business hours are required');
    } else {
      const validDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      for (const day of validDays) {
        if (!config.hours[day]) {
          errors.push(`Hours for ${day} are required`);
        } else if (config.hours[day] !== 'closed') {
          const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]-([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
          if (!timeRegex.test(config.hours[day])) {
            errors.push(`Invalid time format for ${day}`);
          }
        }
      }
    }
    
    if (config.settings) {
      if (config.settings.buffer_minutes && (isNaN(config.settings.buffer_minutes) || config.settings.buffer_minutes < 0)) {
        errors.push('Buffer minutes must be a positive number');
      }
      
      if (config.settings.max_bookings_per_day && (isNaN(config.settings.max_bookings_per_day) || config.settings.max_bookings_per_day < 1)) {
        errors.push('Max bookings per day must be at least 1');
      }
      
      if (config.settings.advance_booking_days && (isNaN(config.settings.advance_booking_days) || config.settings.advance_booking_days < 1)) {
        errors.push('Advance booking days must be at least 1');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = Validation;