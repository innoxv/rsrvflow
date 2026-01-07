const DatabaseService = require('../services/supabase');

class BusinessHandler {
  async setupBusiness(req, res) {
    try {
      const { 
        ownerPhone, 
        businessName, 
        businessType, 
        timezone = 'Africa/Nairobi',
        email = '',
        address = ''
      } = req.body;
      
      if (!ownerPhone || !businessName || !businessType) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: ownerPhone, businessName, businessType'
        });
      }
      
      // Check if business already exists
      const existing = await DatabaseService.getBusinessByPhone(ownerPhone);
      if (existing) {
        return res.json({
          success: true,
          message: 'Business already exists',
          business: existing,
          existing: true
        });
      }
      
      // Create new business
      const businessData = {
        name: businessName,
        type: businessType,
        phone: ownerPhone,
        timezone,
        email,
        address
      };
      
      const business = await DatabaseService.createBusiness(businessData);
      
      res.json({
        success: true,
        message: 'Business setup completed successfully!',
        business,
        nextSteps: [
          'Send a WhatsApp message to start using your booking bot',
          'Use /connect-calendar to sync with Google Calendar',
          'Use /update-hours to set your business hours'
        ]
      });
      
    } catch (error) {
      console.error('Business setup error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getBusinessConfig(req, res) {
    try {
      const { businessId } = req.params;
      
      const business = await DatabaseService.getBusinessById(businessId);
      if (!business) {
        return res.status(404).json({
          success: false,
          error: 'Business not found'
        });
      }
      
      // Get services
      const services = await DatabaseService.getServices(businessId);
      
      res.json({
        success: true,
        business,
        services,
        config: business.config || {}
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async updateBusinessHours(req, res) {
    try {
      const { businessId } = req.params;
      const { hours } = req.body;
      
      if (!hours || typeof hours !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Invalid hours format'
        });
      }
      
      const business = await DatabaseService.getBusinessById(businessId);
      if (!business) {
        return res.status(404).json({
          success: false,
          error: 'Business not found'
        });
      }
      
      // Update config
      const updatedConfig = {
        ...business.config,
        hours
      };
      
      const updatedBusiness = await DatabaseService.updateBusinessConfig(businessId, updatedConfig);
      
      res.json({
        success: true,
        message: 'Business hours updated successfully',
        business: updatedBusiness,
        hours
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async updateServices(req, res) {
    try {
      const { businessId } = req.params;
      const { services } = req.body;
      
      if (!Array.isArray(services)) {
        return res.status(400).json({
          success: false,
          error: 'Services must be an array'
        });
      }
      
      // Delete existing services
      await DatabaseService.supabase
        .from('services')
        .delete()
        .eq('business_id', businessId);
      
      // Insert new services
      for (const service of services) {
        await DatabaseService.supabase
          .from('services')
          .insert({
            business_id: businessId,
            name: service.name,
            duration_minutes: service.duration_minutes || 30,
            price: service.price || 0,
            description: service.description || '',
            is_active: true
          });
      }
      
      res.json({
        success: true,
        message: `Updated ${services.length} services`,
        services
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async getBusinessStats(req, res) {
    try {
      const { businessId } = req.params;
      const { startDate, endDate } = req.query;
      
      const business = await DatabaseService.getBusinessById(businessId);
      if (!business) {
        return res.status(404).json({
          success: false,
          error: 'Business not found'
        });
      }
      
      // Calculate date range
      const start = startDate ? new Date(startDate) : new Date();
      start.setHours(0, 0, 0, 0);
      
      const end = endDate ? new Date(endDate) : new Date();
      end.setHours(23, 59, 59, 999);
      
      // Get bookings in date range
      const bookings = await DatabaseService.getBookingsByBusiness(businessId, start, end);
      
      // Calculate statistics
      const totalBookings = bookings.length;
      const confirmedBookings = bookings.filter(b => b.status === 'confirmed').length;
      const cancelledBookings = bookings.filter(b => b.status === 'cancelled').length;
      
      // Revenue calculation (if prices are stored)
      const revenue = bookings
        .filter(b => b.status === 'confirmed')
        .reduce((sum, booking) => sum + (booking.price || 0), 0);
      
      // Popular services
      const serviceCounts = {};
      bookings.forEach(booking => {
        if (booking.service_name) {
          serviceCounts[booking.service_name] = (serviceCounts[booking.service_name] || 0) + 1;
        }
      });
      
      const popularServices = Object.entries(serviceCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      res.json({
        success: true,
        stats: {
          totalBookings,
          confirmedBookings,
          cancelledBookings,
          cancellationRate: totalBookings > 0 ? (cancelledBookings / totalBookings * 100).toFixed(1) : 0,
          revenue: `$${revenue.toFixed(2)}`,
          period: {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0]
          }
        },
        popularServices,
        bookings: bookings.slice(0, 10) // Return recent bookings
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new BusinessHandler();