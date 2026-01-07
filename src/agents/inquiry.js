const DatabaseService = require('../services/supabase');
const { format } = require('date-fns');

class InquiryAgent {
  constructor(business) {
    this.business = business;
  }

  async handleInquiry(type, customerPhone) {
    switch (type) {
      case 'services':
        return await this.getServicesList();
      
      case 'hours':
        return await this.getBusinessHours();
      
      case 'location':
        return await this.getLocation();
      
      case 'price':
        return await this.getPriceList();
      
      case 'bookings':
        return await this.getCustomerBookings(customerPhone);
      
      case 'contact':
        return await this.getContactInfo();
      
      default:
        return this.getGeneralInfo();
    }
  }

  async getServicesList() {
    const services = await DatabaseService.getServices(this.business.id);
    
    if (services.length === 0) {
      return "We don't have any services listed yet. Please check back later or contact us directly.";
    }
    
    const serviceList = services.map(service => 
      `• ${service.name} (${service.duration_minutes} min)${service.price ? ` - $${service.price}` : ''}`
    ).join('\n');
    
    return `📋 *Our Services:*\n\n${serviceList}\n\nTo book, tell me which service you'd like and when.`;
  }

  async getBusinessHours() {
    const hours = this.business.config?.hours || {};
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    const hourList = days.map(day => {
      const dayKey = day.slice(0, 3).toLowerCase();
      const dayHours = hours[dayKey];
      return `• ${day}: ${dayHours === 'closed' ? 'Closed' : dayHours}`;
    }).join('\n');
    
    return `🕒 *Business Hours:*\n\n${hourList}\n\nWe recommend booking in advance to secure your preferred time.`;
  }

  async getLocation() {
    const address = this.business.address || 'Location not specified';
    const name = this.business.name;
    
    return `📍 *Location:*\n\n${name}\n${address}\n\nNeed directions? We can help you find your way.`;
  }

  async getPriceList() {
    const services = await DatabaseService.getServices(this.business.id);
    const pricedServices = services.filter(s => s.price > 0);
    
    if (pricedServices.length === 0) {
      return "Pricing information is not available. Please contact us for pricing details.";
    }
    
    const priceList = pricedServices.map(service => 
      `• ${service.name}: $${service.price}`
    ).join('\n');
    
    return `💰 *Pricing:*\n\n${priceList}\n\n*Note:* Prices may vary based on specific requirements. Contact us for exact pricing.`;
  }

  async getCustomerBookings(customerPhone) {
    const bookings = await DatabaseService.getBookingsByCustomer(customerPhone, this.business.id);
    
    if (bookings.length === 0) {
      return "You don't have any upcoming bookings with us.";
    }
    
    const bookingList = bookings.map((booking, index) => {
      const startTime = new Date(booking.start_time);
      return `${index + 1}. ${booking.service_name} - ${format(startTime, 'MMM dd')} at ${format(startTime, 'h:mm a')} (${booking.status})`;
    }).join('\n');
    
    return `📅 *Your Upcoming Bookings:*\n\n${bookingList}\n\nTo cancel or reschedule, reply with the booking number.`;
  }

  async getContactInfo() {
    const phone = this.business.owner_phone;
    const email = this.business.email || 'Not provided';
    const address = this.business.address || 'Not provided';
    
    return `📞 *Contact Us:*\n\nPhone: ${phone}\nEmail: ${email}\nAddress: ${address}\n\nWe typically respond within 1-2 hours during business hours.`;
  }

  getGeneralInfo() {
    return `*About ${this.business.name}:*\n\n` +
      `We're a ${this.business.business_type} business ready to serve you!\n\n` +
      `You can ask me about:\n` +
      `• Services we offer\n` +
      `• Business hours\n` +
      `• Pricing\n` +
      `• Our location\n` +
      `• Your bookings\n` +
      `• Contact information\n\n` +
      `Or simply tell me what service you want and when you'd like to book!`;
  }

  async handleFaq(question) {
    const faqs = {
      'how to book': 'To book an appointment, just tell me what service you want and when you\'d like to come in. For example: "I want a haircut tomorrow at 3pm"',
      'cancellation policy': 'We require 24 hours notice for cancellations. Late cancellations may incur a fee.',
      'payment methods': 'We accept cash, credit cards, and mobile payments. Payment is due at time of service.',
      'running late': 'Please let us know if you\'re running late. We\'ll do our best to accommodate you, but may need to reschedule.',
      'children allowed': 'Children are welcome! Please let us know if you\'re bringing children so we can prepare.',
      'parking available': 'We have parking available. Please ask for details when you arrive.',
      'what to bring': 'Just bring yourself! We provide all necessary equipment and supplies.',
      'COVID safety': 'We follow all local health guidelines. Masks and sanitization stations are available.'
    };

    const questionLower = question.toLowerCase();
    
    for (const [key, answer] of Object.entries(faqs)) {
      if (questionLower.includes(key)) {
        return `*${key.charAt(0).toUpperCase() + key.slice(1)}:*\n\n${answer}`;
      }
    }
    
    return "I'm not sure about that specific question. Please contact us directly for more detailed information.";
  }
}

module.exports = InquiryAgent;