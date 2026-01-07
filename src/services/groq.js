const Groq = require('groq-sdk');
const config = require('../config');
const { format, parseISO, addMinutes, isSameDay } = require('date-fns');

class GroqService {
  constructor() {
    this.groq = new Groq({ apiKey: config.groq.apiKey });
    this.model = config.groq.model;
  }

  async processMessage(message, context = {}) {
    const prompt = this.buildPrompt(message, context);
    
    try {
      const completion = await this.groq.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.groq.temperature,
        max_tokens: config.groq.maxTokens,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0].message.content;
      return this.parseResponse(response);
    } catch (error) {
      console.error('Groq API error:', error);
      return this.getFallbackResponse();
    }
  }

  buildPrompt(message, context) {
    const { business, conversation, availableSlots = [] } = context;
    
    return `You are an intelligent booking assistant for ${business?.name || 'a business'}. 
Your role is to help customers book appointments through WhatsApp.

CONTEXT:
- Business Type: ${business?.business_type || 'service business'}
- Available Services: ${this.formatServices(business)}
- Business Hours: ${this.formatHours(business)}
- Current Date: ${new Date().toISOString().split('T')[0]}
- Customer: ${conversation?.customer_name || 'New customer'}
- Conversation History: ${JSON.stringify(conversation?.history?.slice(-5) || [])}

USER MESSAGE: "${message}"

AVAILABLE TIME SLOTS (if relevant):
${availableSlots.map(slot => `- ${slot.formatted} (${slot.duration} min)`).join('\n')}

INSTRUCTIONS:
1. Understand the user's intent: booking, inquiry, cancellation, rescheduling, or general question
2. Extract relevant information: service, date, time, number of people, special requests
3. If booking, confirm all details before finalizing
4. If information is missing, ask clarifying questions
5. Be friendly, professional, and concise
6. For bookings, always confirm date, time, and service
7. Suggest alternatives if requested time is unavailable

RESPONSE FORMAT (JSON only):
{
  "intent": "booking|inquiry|cancellation|reschedule|clarification|greeting",
  "action": "ask_service|ask_date|ask_time|confirm|provide_options|complete|transfer_human",
  "response": "Your natural language response",
  "data": {
    "service": "service name or null",
    "date": "YYYY-MM-DD or null",
    "time": "HH:MM or null",
    "party_size": number or null,
    "notes": "special requests or null",
    "confirmed": boolean
  },
  "confidence": 0.0 to 1.0,
  "suggestions": ["array of suggested times if applicable"]
}

Respond in JSON format:`;
  }

  formatServices(business) {
    if (!business?.config?.services) return 'Not specified';
    
    const services = business.config.services;
    if (Array.isArray(services)) {
      return services.map(s => `${s.name} (${s.duration} min)`).join(', ');
    }
    
    return Object.entries(services)
      .map(([name, details]) => `${name} (${details.duration_minutes || 30} min)`)
      .join(', ');
  }

  formatHours(business) {
    if (!business?.config?.hours) return '9 AM - 5 PM Mon-Fri';
    
    const hours = business.config.hours;
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    
    return days.map(day => {
      const dayHours = hours[day];
      if (!dayHours || dayHours === 'closed') return null;
      
      const dayName = day.charAt(0).toUpperCase() + day.slice(1);
      return `${dayName}: ${dayHours}`;
    }).filter(Boolean).join('; ');
  }

  parseResponse(response) {
    try {
      const parsed = JSON.parse(response);
      
      // Validate required fields
      if (!parsed.intent || !parsed.response) {
        throw new Error('Invalid response format');
      }
      
      // Ensure data object exists
      parsed.data = parsed.data || {};
      
      return parsed;
    } catch (error) {
      console.error('Failed to parse Groq response:', error);
      return this.getFallbackResponse();
    }
  }

  getFallbackResponse() {
    return {
      intent: 'inquiry',
      action: 'clarification',
      response: "I'm having trouble understanding. Could you please rephrase your request?",
      data: {},
      confidence: 0.1,
      suggestions: []
    };
  }

  // Specialized function for date/time parsing
  async extractDateTime(text) {
    const prompt = `Extract date and time from the following text. Return JSON with date (YYYY-MM-DD) and time (HH:MM). If not specified, use null.
    
    Text: "${text}"
    
    Today is ${new Date().toISOString().split('T')[0]}
    
    Examples:
    - "tomorrow at 3pm" -> {"date": "tomorrow's date", "time": "15:00"}
    - "next Tuesday" -> {"date": "next Tuesday's date", "time": null}
    - "at 2:30" -> {"date": null, "time": "14:30"}
    
    Return JSON only:`;
    
    try {
      const completion = await this.groq.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 100,
        response_format: { type: 'json_object' }
      });

      const response = JSON.parse(completion.choices[0].message.content);
      return response;
    } catch (error) {
      return { date: null, time: null };
    }
  }
}

module.exports = new GroqService();