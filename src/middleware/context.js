const DatabaseService = require('../services/supabase');

async function conversationContext(req, res, next) {
  try {
    const userPhone = req.body.From ? req.body.From.replace('whatsapp:', '') : null;
    
    if (!userPhone) {
      return next();
    }
    
    // Get business context
    const business = await determineBusinessContext(userPhone);
    
    if (business) {
      req.business = business;
      
      // Get or create conversation
      const conversation = await DatabaseService.getOrCreateConversation(userPhone, business.id);
      req.conversation = conversation;
      
      // Add metadata to request
      req.context = {
        businessId: business.id,
        businessType: business.business_type,
        conversationId: conversation.id,
        customerPhone: userPhone,
        timestamp: new Date().toISOString()
      };
    }
    
    next();
  } catch (error) {
    console.error('Context middleware error:', error);
    next();
  }
}

async function determineBusinessContext(userPhone) {
  // Check if user is a business owner
  const business = await DatabaseService.getBusinessByPhone(userPhone);
  if (business) {
    return business;
  }
  
  // For customers: Look up based on conversation history
  // This is simplified - in production you'd have proper routing
  const { data: conversations } = await DatabaseService.supabase
    .from('conversations')
    .select('business_id')
    .eq('phone_number', userPhone)
    .order('updated_at', { ascending: false })
    .limit(1);
  
  if (conversations && conversations.length > 0) {
    return await DatabaseService.getBusinessById(conversations[0].business_id);
  }
  
  // Default to first business (for MVP)
  const { data: businesses } = await DatabaseService.supabase
    .from('businesses')
    .select('*')
    .limit(1);
  
  return businesses?.[0] || null;
}

function validateWebhook(req, res, next) {
  // Skip validation in development
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  
  const TwilioService = require('../services/twilio');
  const isValid = TwilioService.validateWebhookSignature(req);
  
  if (!isValid) {
    console.error('Invalid Twilio webhook signature');
    return res.status(403).send('Invalid signature');
  }
  
  next();
}

function rateLimitMiddleware(req, res, next) {
  // Simple in-memory rate limiting for MVP
  // In production, use a proper rate limiter like express-rate-limit with Redis
  const rateLimitWindow = 60 * 1000; // 1 minute
  const maxRequests = 10; // 10 requests per minute
  
  if (!req.app.locals.rateLimit) {
    req.app.locals.rateLimit = new Map();
  }
  
  const userPhone = req.body.From ? req.body.From.replace('whatsapp:', '') : req.ip;
  const now = Date.now();
  
  if (!req.app.locals.rateLimit.has(userPhone)) {
    req.app.locals.rateLimit.set(userPhone, {
      count: 1,
      resetTime: now + rateLimitWindow
    });
    return next();
  }
  
  const userData = req.app.locals.rateLimit.get(userPhone);
  
  if (now > userData.resetTime) {
    // Reset window
    userData.count = 1;
    userData.resetTime = now + rateLimitWindow;
    return next();
  }
  
  if (userData.count >= maxRequests) {
    return res.status(429).send('Too many requests. Please try again later.');
  }
  
  userData.count++;
  next();
}

module.exports = {
  conversationContext,
  validateWebhook,
  rateLimitMiddleware
};