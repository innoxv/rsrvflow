const cron = require('node-cron');
const DatabaseService = require('./supabase');
const TwilioService = require('./twilio');
const { format, addHours, isBefore } = require('date-fns');

class SchedulerService {
  constructor() {
    this.initSchedules();
  }

  initSchedules() {
    // Daily reminder check at 9 AM
    cron.schedule('0 9 * * *', () => {
      console.log('⏰ Running daily reminder check...');
      this.sendDailyReminders();
    });

    // Hourly cleanup of old conversations (keep 7 days)
    cron.schedule('0 * * * *', () => {
      this.cleanupOldConversations();
    });

    // Check for upcoming bookings every 30 minutes
    cron.schedule('*/30 * * * *', () => {
      this.checkUpcomingBookings();
    });

    console.log('📅 Scheduler initialized with daily reminders and hourly cleanup');
  }

  async sendDailyReminders() {
    try {
      const hoursBefore = 24; // Send reminders 24 hours before
      const bookings = await DatabaseService.getUpcomingReminders(hoursBefore);
      
      console.log(`📨 Sending reminders for ${bookings.length} bookings...`);
      
      for (const booking of bookings) {
        try {
          const startTime = new Date(booking.start_time);
          const business = booking.businesses;
          
          const message = `🔔 Reminder: Your ${booking.service_name} appointment at ${business.name} is tomorrow at ${format(startTime, 'h:mm a')}. Please reply CANCEL if you need to reschedule.`;
          
          await TwilioService.sendMessage(booking.customer_phone, message);
          
          // Mark as sent
          await DatabaseService.markReminderSent(booking.id);
          
          console.log(`✓ Sent reminder to ${booking.customer_phone} for booking ${booking.id}`);
          
          // Rate limiting: wait 1 second between messages
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error(`Failed to send reminder for booking ${booking.id}:`, error);
        }
      }
      
      console.log(`✅ Sent ${bookings.length} reminders successfully`);
      
    } catch (error) {
      console.error('Error in sendDailyReminders:', error);
    }
  }

  async cleanupOldConversations() {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const { data, error } = await DatabaseService.supabase
        .from('conversations')
        .delete()
        .lt('updated_at', sevenDaysAgo.toISOString());
      
      if (error) {
        console.error('Cleanup error:', error);
      } else if (data?.length > 0) {
        console.log(`🧹 Cleaned up ${data.length} old conversations`);
      }
      
    } catch (error) {
      console.error('Error in cleanup:', error);
    }
  }

  async checkUpcomingBookings() {
    try {
      const now = new Date();
      const oneHourFromNow = addHours(now, 1);
      
      const { data: bookings, error } = await DatabaseService.supabase
        .from('bookings')
        .select(`
          *,
          businesses (name, owner_phone)
        `)
        .eq('status', 'confirmed')
        .gte('start_time', now.toISOString())
        .lte('start_time', oneHourFromNow.toISOString())
        .eq('upcoming_notification_sent', false);
      
      if (error) {
        console.error('Error checking upcoming bookings:', error);
        return;
      }
      
      for (const booking of bookings) {
        // Send notification to business owner
        const businessMessage = `⏰ Upcoming: ${booking.service_name} for ${booking.customer_name || booking.customer_phone} at ${format(new Date(booking.start_time), 'h:mm a')}`;
        
        try {
          await TwilioService.sendMessage(booking.businesses.owner_phone, businessMessage);
          
          // Mark as notified
          await DatabaseService.supabase
            .from('bookings')
            .update({ upcoming_notification_sent: true })
            .eq('id', booking.id);
          
          console.log(`✓ Sent upcoming notification for booking ${booking.id}`);
        } catch (error) {
          console.error(`Failed to send notification for booking ${booking.id}:`, error);
        }
      }
      
    } catch (error) {
      console.error('Error in checkUpcomingBookings:', error);
    }
  }

  // Manual trigger for testing
  async triggerRemindersManually() {
    console.log('🔄 Manually triggering reminders...');
    await this.sendDailyReminders();
  }
}

// Export singleton instance
const scheduler = new SchedulerService();
module.exports = scheduler;