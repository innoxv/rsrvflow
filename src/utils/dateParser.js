const { parse, format, addDays, nextDay, isToday, isTomorrow } = require('date-fns');

class DateParser {
  static parseNaturalLanguage(text, referenceDate = new Date()) {
    const lowerText = text.toLowerCase();
    
    // Handle "today"
    if (lowerText.includes('today')) {
      return {
        date: format(referenceDate, 'yyyy-MM-dd'),
        time: this.extractTime(text) || null
      };
    }
    
    // Handle "tomorrow"
    if (lowerText.includes('tomorrow')) {
      const tomorrow = addDays(referenceDate, 1);
      return {
        date: format(tomorrow, 'yyyy-MM-dd'),
        time: this.extractTime(text) || null
      };
    }
    
    // Handle day names
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const day of days) {
      if (lowerText.includes(day)) {
        const dayIndex = days.indexOf(day);
        const nextDate = nextDay(referenceDate, dayIndex);
        return {
          date: format(nextDate, 'yyyy-MM-dd'),
          time: this.extractTime(text) || null
        };
      }
    }
    
    // Handle "next week"
    if (lowerText.includes('next week')) {
      const nextWeek = addDays(referenceDate, 7);
      return {
        date: format(nextWeek, 'yyyy-MM-dd'),
        time: this.extractTime(text) || null
      };
    }
    
    // Handle date patterns like "Jan 15" or "01/15"
    const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/) || 
                     text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2})/i);
    
    if (dateMatch) {
      try {
        let date;
        if (dateMatch[0].includes('/')) {
          // MM/DD or MM/DD/YYYY format
          const [month, day, year] = dateMatch[0].split('/');
          const fullYear = year ? (year.length === 2 ? `20${year}` : year) : referenceDate.getFullYear();
          date = new Date(fullYear, month - 1, day);
        } else {
          // Month name format
          const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
          const month = monthNames.findIndex(m => dateMatch[1].toLowerCase().startsWith(m));
          const day = parseInt(dateMatch[2]);
          const year = referenceDate.getFullYear();
          date = new Date(year, month, day);
        }
        
        if (date < referenceDate) {
          date.setFullYear(date.getFullYear() + 1);
        }
        
        return {
          date: format(date, 'yyyy-MM-dd'),
          time: this.extractTime(text) || null
        };
      } catch (e) {
        // If date parsing fails, continue
      }
    }
    
    return {
      date: null,
      time: this.extractTime(text) || null
    };
  }

  static extractTime(text) {
    const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
    const matches = [...text.matchAll(timeRegex)];
    
    if (matches.length === 0) {
      return null;
    }
    
    // Use the first time match
    const match = matches[0];
    let hours = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const period = match[3]?.toLowerCase();
    
    // Convert to 24-hour format
    if (period === 'pm' && hours < 12) {
      hours += 12;
    } else if (period === 'am' && hours === 12) {
      hours = 0;
    }
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  static formatForDisplay(dateString, timeString = null) {
    if (!dateString) return 'Date not specified';
    
    const date = new Date(dateString);
    let formatted = format(date, 'EEEE, MMMM do, yyyy');
    
    if (timeString) {
      const [hours, minutes] = timeString.split(':').map(Number);
      const timeDate = new Date(date);
      timeDate.setHours(hours, minutes);
      formatted += ` at ${format(timeDate, 'h:mm a')}`;
    }
    
    return formatted;
  }

  static isBusinessDay(date, businessHours) {
    const dayOfWeek = format(date, 'EEE').toLowerCase();
    return businessHours && businessHours[dayOfWeek] && businessHours[dayOfWeek] !== 'closed';
  }

  static getNextAvailableDate(startDate, businessHours) {
    let currentDate = new Date(startDate);
    let attempts = 0;
    const maxAttempts = 30; // Look ahead 30 days
    
    while (attempts < maxAttempts) {
      if (this.isBusinessDay(currentDate, businessHours)) {
        return currentDate;
      }
      currentDate = addDays(currentDate, 1);
      attempts++;
    }
    
    return null;
  }
}

module.exports = DateParser;