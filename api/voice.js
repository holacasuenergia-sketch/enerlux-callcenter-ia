/**
 * Twilio Voice Webhook - POST /api/voice
 */
import twilio from 'twilio';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Saludo inicial y captura de respuesta
  const gather = twiml.gather({
    input: 'speech',
    action: '/api/gather',
    method: 'POST',
    speechTimeout: 'auto',
    language: 'es-ES'
  });
  
  gather.say({
    voice: 'Polly.Lucia',
    language: 'es-ES'
  }, 'Hola, le llamo de Enerlux. ¿Podría hablar un momento sobre su factura de luz? Podemos ofrecerle un ahorro del 15 al 20 por ciento mensual, sin permanencia.');
  
  // Si no hay respuesta
  twiml.say('No hemos detectado respuesta. Gracias por su tiempo, que tenga un buen día.');
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
}