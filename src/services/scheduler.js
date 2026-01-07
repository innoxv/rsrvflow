const cron = require('node-cron');
const DatabaseService = require('./supabase');
const TwilioService = require('./twilio');
const { format, addHours } = require('date-fns');

class SchedulerService {
  constructor() {
    // Initialize only if in production AND no errors
    if (process.env.NODE_ENV === 'production' && !process.env.DISABLE_SCHEDULER) {
      this.initSchedules();
    }
  }

  initSchedules() {
    try {
      // Daily reminders at 9 AM Nairobi (6 AM UTC)
      cron.schedule('0 6 * * *', () => {
        console.log('⏰ Running daily reminder check...');
        this.sendDailyReminders();
      }, {
        scheduled: true,
        timezone: "Africa/Nairobi"
      });

      console.log('📅 Scheduler initialized (daily reminders only)');
      
    } catch (error) {
      console.error('❌ Failed to initialize scheduler:', error.message);
      console.log('⚠️ Scheduler disabled. Bot will still work for messaging.');
    }
  }

  async sendDailyReminders() {
    try {
      console.log('🔔 Starting daily reminders...');
      
      // Get bookings for tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      
      const { data: bookings, error } = await DatabaseService.supabase
        .from('bookings')
        .select(`
          *,
          businesses (name, owner_phone)
        `)
        .eq('status', 'confirmed')
        .eq('reminder_sent', false)
        .gte('start_time', tomorrow.toISOString())
        .lte('start_time', dayAfter.toISOString());
      
      if (error) {
        console.error('Database error in reminders:', error);
        return;
      }
      
      if (!bookings || bookings.length === 0) {
        console.log('No reminders to send today.');
        return;
      }
      
      console.log(`📨 Found ${bookings.length} bookings for reminders`);
      
      for (const booking of bookings) {
        try {
          const startTime = new Date(booking.start_time);
          const business = booking.businesses || {};
          
          const message = `🔔 Reminder: Your ${booking.service_name} appointment at ${business.name || 'our business'} is tomorrow at ${format(startTime, 'h:mm a')}. Please reply CANCEL if you need to reschedule.`;
          
          await TwilioService.sendMessage(booking.customer_phone, message);
          
          // Mark as sent
          await DatabaseService.supabase
            .from('bookings')
            .update({ reminder_sent: true })
            .eq('id', booking.id);
          
          console.log(`✓ Sent reminder to ${booking.customer_phone}`);
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error(`Failed reminder for booking ${booking.id}:`, error.message);
        }
      }
      
      console.log('✅ Reminders sent successfully');
      
    } catch (error) {
      console.error('Error in sendDailyReminders:', error.message);
    }
  }

  // Disable problematic methods temporarily
  async checkUpcomingBookings() {
    // Disabled for now
    return;
  }

  async cleanupOldConversations() {
    // Disabled for now
    return;
  }
}

module.exports = new SchedulerService();