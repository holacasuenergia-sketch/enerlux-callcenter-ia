/**
 * Procesar respuesta del usuario - POST /api/gather
 */
import twilio from 'twilio';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  
  const speechResult = req.body.SpeechResult || '';
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Respuesta simple basada en palabras clave
  let respuesta = '';
  const speech = speechResult.toLowerCase();
  
  if (speech.includes('si') || speech.includes('interesado') || speech.includes('claro')) {
    respuesta = 'Perfecto. Para proceder, necesitaré su número de cuenta bancaria IBAN para formalizar el cambio. ¿Podría facilitármelo?';
  } else if (speech.includes('no') || speech.includes('puedo') || speech.includes('ahora no')) {
    respuesta = 'Entiendo. ¿Conoce a alguien que pueda estar interesado en ahorrar en su factura de luz?';
  } else if (speech.includes('cuanto') || speech.includes('ahorro') || speech.includes('cuánto')) {
    respuesta = 'El ahorro garantizado es del 15 al 20 por ciento mensual. Sin permanencia y con energía 100 por ciento renovable. ¿Estaría interesado?';
  } else if (speech.includes('iban') || speech.includes('cuenta')) {
    respuesta = 'Perfecto, anotamos sus datos. En las próximas 24 horas recibirá la documentación para firmar. ¿Tiene alguna otra pregunta?';
  } else {
    respuesta = 'Nuestro servicio le permite ahorrar entre un 15 y un 20 por ciento en su factura mensual de luz, sin permanencia y con energía renovable. ¿Estaría interesado en conocer más detalles?';
  }
  
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
  }, respuesta);
  
  twiml.say('Gracias por su atención. Que tenga un buen día.');
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
}