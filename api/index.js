/**
 * ENERLUX CALL CENTER IA - Vercel Serverless Functions
 */

const twilio = require('twilio');

// Lazy load Twilio client
let twilioClient = null;
function getTwilioClient() {
  if (!twilioClient) {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return twilioClient;
}

// Health check
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const path = req.url.split('?')[0];
  
  // GET /api/health
  if (req.method === 'GET' && (path === '/api/health' || path === '/api' || path === '/')) {
    return res.status(200).json({
      status: 'ok',
      service: 'Enerlux Call Center IA',
      version: '1.0.0',
      config: {
        twilio: !!process.env.TWILIO_ACCOUNT_SID,
        openai: !!process.env.OPENAI_API_KEY,
        elevenlabs: !!process.env.ELEVENLABS_API_KEY
      }
    });
  }
  
  // POST /api/call - Iniciar llamada
  if (req.method === 'POST' && path === '/api/call') {
    try {
      const { telefono, nombre } = req.body;
      
      if (!telefono) {
        return res.status(400).json({ error: 'Teléfono requerido' });
      }
      
      // Format phone number
      let phone = telefono.replace(/\D/g, '');
      if (!phone.startsWith('34') && phone.length === 9) {
        phone = '34' + phone;
      }
      
      const client = getTwilioClient();
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : process.env.BASE_URL || 'https://enerlux-callcenter-ia.vercel.app';
      
      const call = await client.calls.create({
        to: `+${phone}`,
        from: process.env.TWILIO_PHONE_NUMBER || '+34610243061',
        url: `${baseUrl}/api/twilio/voice`,
        statusCallback: `${baseUrl}/api/twilio/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
      });
      
      return res.status(200).json({
        success: true,
        sid: call.sid,
        status: call.status,
        mensaje: `Llamada iniciada a ${nombre || telefono}`
      });
      
    } catch (error) {
      console.error('Error iniciando llamada:', error);
      return res.status(500).json({ 
        error: error.message,
        details: error.code || 'unknown'
      });
    }
  }
  
  // POST /api/twilio/voice - Webhook cuando alguien contesta
  if (req.method === 'POST' && path.includes('/twilio/voice')) {
    const twiml = new twilio.twiml.VoiceResponse();
    
    const gather = twiml.gather({
      input: 'speech',
      action: '/api/twilio/gather',
      method: 'POST',
      speechTimeout: 'auto',
      language: 'es-ES'
    });
    
    gather.say({
      voice: 'Polly.Lucia',
      language: 'es-ES'
    }, 'Hola, le llamo de Enerlux. ¿Podría hablar un momento sobre su factura de luz? Podemos ofrecerle un ahorro del 15 al 20 por ciento mensual, sin permanencia y con energía 100 por ciento renovable.');
    
    twiml.say('No hemos detectado respuesta. Gracias por su tiempo, que tenga un buen día.');
    
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml.toString());
  }
  
  // POST /api/twilio/gather - Procesar respuesta del usuario
  if (req.method === 'POST' && path.includes('/twilio/gather')) {
    const speechResult = req.body.SpeechResult || '';
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Respuesta simple basada en palabras clave
    let respuesta = 'Entiendo. ';
    
    if (speechResult.toLowerCase().includes('si') || speechResult.toLowerCase().includes('interesado')) {
      respuesta = 'Perfecto. Para proceder, necesitaré su número de cuenta bancaria IBAN para formalizar el cambio. ¿Podría facilitármelo?';
    } else if (speechResult.toLowerCase().includes('no') || speechResult.toLowerCase().includes('puedo')) {
      respuesta = 'Entiendo. ¿Conoce a alguien que pueda estar interesado en ahorrar en su factura de luz?';
    } else if (speechResult.toLowerCase().includes('cuanto') || speechResult.toLowerCase().includes('ahorro')) {
      respuesta = 'El ahorro garantizado es del 15 al 20 por ciento mensual. Además, no tiene permanencia y la energía es 100 por ciento renovable. ¿Le gustaría que le enviemos más información?';
    } else {
      respuesta = 'Nuestro servicio le permite ahorrar entre un 15 y un 20 por ciento en su factura mensual de luz, sin permanencia y con energía renovable. ¿Estaría interesado en conocer más detalles?';
    }
    
    const gather = twiml.gather({
      input: 'speech',
      action: '/api/twilio/gather',
      method: 'POST',
      speechTimeout: 'auto',
      language: 'es-ES'
    });
    
    gather.say({
      voice: 'Polly.Lucia',
      language: 'es-ES'
    }, respuesta);
    
    twiml.say('Gracias por su atención. Que tenga un buen día.');
    
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml.toString());
  }
  
  // POST /api/twilio/status - Estado de la llamada
  if (req.method === 'POST' && path.includes('/twilio/status')) {
    console.log('Call status:', req.body);
    return res.status(200).end();
  }
  
  // Default - API info
  return res.status(200).json({
    service: 'Enerlux Call Center IA',
    endpoints: {
      'GET /api/health': 'Health check',
      'POST /api/call': 'Iniciar llamada (body: {telefono, nombre})',
      'POST /api/twilio/voice': 'Twilio voice webhook',
      'POST /api/twilio/gather': 'Procesar respuesta',
      'POST /api/twilio/status': 'Estado de llamada'
    }
  });
};