/**
 * ENERLUX CALL CENTER IA - SERVIDOR TWILIO
 * Sistema de llamadas automatizadas con Twilio + OpenAI
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const twilio = require('twilio');
const WebSocket = require('ws');
const http = require('http');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Twilio Client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Estado del sistema
let sistemaEstado = {
  activo: false,
  llamando: false,
  llamadaActual: null,
  clientes: [],
  clienteActual: null
};

// Conexiones WebSocket activas
const clientes = new Set();

wss.on('connection', (ws) => {
  clientes.add(ws);
  ws.send(JSON.stringify({ type: 'estado', data: sistemaEstado }));
  
  ws.on('close', () => clientes.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clientes.forEach(ws => ws.send(msg));
}

// ========================================
// API REST
// ========================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    twilio: !!process.env.TWILIO_ACCOUNT_SID,
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY
  });
});

// Obtener estado
app.get('/api/estado', (req, res) => {
  res.json(sistemaEstado);
});

// Cargar clientes
app.post('/api/clientes', (req, res) => {
  const { clientes } = req.body;
  
  if (!Array.isArray(clientes)) {
    return res.status(400).json({ error: 'Se espera un array de clientes' });
  }
  
  sistemaEstado.clientes = clientes.map(c => ({
    ...c,
    estado: 'pendiente',
    intentos: 0
  }));
  
  broadcast({ type: 'clientes', data: sistemaEstado.clientes });
  res.json({ message: `${clientes.length} clientes cargados` });
});

// Iniciar llamada saliente
app.post('/api/llamar/:index', async (req, res) => {
  const index = parseInt(req.params.index);
  const cliente = sistemaEstado.clientes[index];
  
  if (!cliente) {
    return res.status(404).json({ error: 'Cliente no encontrado' });
  }
  
  if (sistemaEstado.llamando) {
    return res.status(400).json({ error: 'Ya hay una llamada en curso' });
  }
  
  try {
    sistemaEstado.llamando = true;
    sistemaEstado.clienteActual = cliente;
    sistemaEstado.clientes[index].estado = 'llamando';
    sistemaEstado.clientes[index].intentos++;
    
    // Formatear número (añadir +34 si no tiene)
    let telefono = cliente.telefono.replace(/\D/g, '');
    if (!telefono.startsWith('34') && telefono.length === 9) {
      telefono = '34' + telefono;
    }
    
    // Crear llamada con Twilio
    const call = await twilioClient.calls.create({
      to: `+${telefono}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${process.env.BASE_URL}/twilio/voice`,
      statusCallback: `${process.env.BASE_URL}/twilio/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      record: true
    });
    
    sistemaEstado.llamadaActual = call.sid;
    
    broadcast({
      type: 'llamada-iniciada',
      data: {
        sid: call.sid,
        cliente: cliente.nombre,
        telefono: cliente.telefono
      }
    });
    
    res.json({ 
      message: 'Llamada iniciada',
      sid: call.sid,
      cliente: cliente.nombre
    });
    
  } catch (error) {
    sistemaEstado.llamando = false;
    sistemaEstado.clientes[index].estado = 'error: ' + error.message;
    broadcast({ type: 'error', data: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Colgar llamada
app.post('/api/colgar', async (req, res) => {
  if (!sistemaEstado.llamadaActual) {
    return res.status(400).json({ error: 'No hay llamada activa' });
  }
  
  try {
    await twilioClient.calls(sistemaEstado.llamadaActual).update({ status: 'completed' });
    res.json({ message: 'Llamada finalizada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// TWILIO WEBHOOKS
// ========================================

// Webhook de voz - se ejecuta cuando alguien contesta
app.post('/twilio/voice', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Mensaje inicial
  const gather = twiml.gather({
    input: 'speech',
    action: '/twilio/gather',
    method: 'POST',
    speechTimeout: 'auto',
    language: 'es-ES'
  });
  
  // Saludo inicial con TTS de ElevenLabs (o fallback)
  gather.say({
    voice: 'Polly.Lucia',
    language: 'es-ES'
  }, 'Hola, le llamo de Enerlux. ¿Podría hablar un momento sobre su factura de luz?');
  
  t
wiml.say('No hemos detectado respuesta. Gracias por su tiempo, que tenga un buen día.');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Procesar respuesta del usuario
app.post('/twilio/gather', async (req, res) => {
  const speechResult = req.body.SpeechResult || '';
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Enviar a WebSocket para que el agente vea la respuesta
  broadcast({
    type: 'usuario-habla',
    data: speechResult
  });
  
  // Procesar con GPT-4
  try {
    const respuesta = await procesarConGPT(speechResult);
    
    broadcast({
      type: 'ia-responde',
      data: respuesta
    });
    
    // Continuar la conversación
    const gather = twiml.gather({
      input: 'speech',
      action: '/twilio/gather',
      method: 'POST',
      speechTimeout: 'auto',
      language: 'es-ES'
    });
    
    gather.say({
      voice: 'Polly.Lucia',
      language: 'es-ES'
    }, respuesta);
    
  } catch (error) {
    twiml.say('Disculpe, ha ocurrido un error. Le volveremos a llamar en otro momento.');
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Estado de la llamada
app.post('/twilio/status', (req, res) => {
  const { CallSid, CallStatus, CallDuration, RecordingUrl } = req.body;
  
  broadcast({
    type: 'estado-llamada',
    data: {
      sid: CallSid,
      status: CallStatus,
      duration: CallDuration,
      recordingUrl: RecordingUrl
    }
  });
  
  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'no-answer') {
    sistemaEstado.llamando = false;
    sistemaEstado.llamadaActual = null;
    
    // Actualizar estado del cliente
    const index = sistemaEstado.clientes.findIndex(c => c === sistemaEstado.clienteActual);
    if (index !== -1) {
      sistemaEstado.clientes[index].estado = CallStatus;
    }
  }
  
  res.sendStatus(200);
});

// ========================================
// GPT-4 INTEGRATION
// ========================================

const historialConversacion = [];

async function procesarConGPT(mensajeUsuario) {
  historialConversacion.push({
    role: 'user',
    content: mensajeUsuario
  });
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Eres un agente telefónico de Enerlux, empresa de cambio de compañía eléctrica en España.
          
Tu objetivo es convencer al cliente de cambiarse a Enerlux para ahorrar en su factura de luz.

REGLAS:
- Sé amable pero persuasivo
- Responde de forma breve (máximo 2 frases)
- Si el cliente está interesado, pide su número de cuenta bancaria para formalizar el cambio
- Si el cliente no está interesado, pregunta si conoce a alguien que pueda estarlo
- Si el cliente tiene preguntas, respóndelas claramente

INFORMACIÓN DE ENERLUX:
- Ahorro garantizado del 15-20% en factura mensual
- Sin permanencia
- Cambio gratis
- 100% energía renovable

Responde SIEMPRE en español, de forma natural y conversacional.`
        },
        ...historialConversacion.slice(-10) // Últimos 10 mensajes
      ],
      max_tokens: 150
    })
  });
  
  const data = await response.json();
  const respuesta = data.choices[0].message.content;
  
  historialConversacion.push({
    role: 'assistant',
    content: respuesta
  });
  
  return respuesta;
}

// ========================================
// INICIAR SERVIDOR
// ========================================

const PORT = process.env.PORT || 3333;
server.listen(PORT, () => {
  console.log(`📞 Call Center IA escuchando en puerto ${PORT}`);
  console.log(`🔗 Panel: http://localhost:${PORT}`);
  console.log(` webhook: ${process.env.BASE_URL}/twilio/voice`);
});