/**
 * ENERLUX CALL CENTER IA
 * Sistema de llamadas con IA para captación de clientes
 * 
 * Flujo:
 * 1. Captura audio de VB-CABLE (desde Zadarma)
 * 2. Transcribe con OpenAI Whisper
 * 3. Genera respuesta con GPT-4
 * 4. Convierte a voz con ElevenLabs
 * 5. Reproduce por VB-CABLE (hacia Zadarma)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Configuración
const CONFIG = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o',
    whisperModel: 'whisper-1'
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB' // Adam - voz masculina española
  },
  audio: {
    inputDevice: process.env.INPUT_DEVICE || 'CABLE Output',
    outputDevice: process.env.OUTPUT_DEVICE || 'CABLE Input',
    sampleRate: 16000
  },
  company: {
    name: process.env.COMPANY_NAME || 'Enerlux',
    service: process.env.COMPANY_SERVICE || 'cambio de compañía eléctrica'
  }
};

// Estado de la conversación
let conversacion = {
  activa: false,
  clienteNombre: null,
  clienteTelefono: null,
  clienteDireccion: null,
  clienteDNI: null,
  interesado: false,
  mensajes: []
};

/**
 * SYSTEM PROMPT - Personalidad del agente de ventas
 */
const SYSTEM_PROMPT = `Eres un agente de ventas de ${CONFIG.company.name}, empresa española especializada en ${CONFIG.company.service}.

OBJETIVO: Conseguir que el cliente acepte cambiar de compañía eléctrica para ahorrar dinero.

PERSONALIDAD:
- Amable, cercano y profesional
- Hablas español de España con naturalidad
- Usas un tono conversacional, no robótico
- Empático con las preocupaciones del cliente

GUION DE LLAMADA:

1. SALUDO (siempre empieza así):
"Hola, le llamo de Enerlux. ¿Es este el [nombre del titular de la factura]?"

2. GANCHO (después de confirmar):
"Le llamo porque hemos detectado que está pagando de más en su factura eléctrica. ¿Podría ahorrarme un minuto para explicarle cómo podemos reducir su factura hasta un 30%?"

3. PROPUESTA (si muestra interés):
"Trabajamos con las principales compañías de España y encontramos la tarifa más barata para su consumo. No tiene que cambiar de contador ni hacer ningún papeleo, nosotros nos encargamos de todo."

4. OBJECIONES COMUNES:
- "Ya tengo una buena tarifa": "Entiendo, pero ¿sabe exactamente cuánto está pagando por kWh? La mayoría de nuestros clientes pensaban lo mismo y ahora ahorran una media de 40€ al mes."
- "No me interesan las ofertas": "Lo entiendo perfectamente. Solo le pregunto: ¿le importaría que le enviemos un comparativo gratuito? Así puede ver cuánto ahorraría sin compromiso."
- "Es una estafa": "Comprendo su desconfianza. Enerlux es una empresa registrada en España. Puede verificarnos en el Registro Mercantil. ¿Le gustaría que le enviemos información por email?"
- "Tengo contrato fijo": "¿Sabe hasta cuándo? A veces hay cláusulas de salida gratuita que la compañía no le informa."

5. CIERRE (cuando el cliente acepta):
"¡Perfecto! Para enviarle la oferta personalizada, necesito confirmar unos datos:
- ¿Su nombre completo es [nombre]?
- ¿Cuál es su dirección actual?
- ¿Podría facilitarme su DNI para verificar la titularidad?"

6. DESPEDIDA:
"Muchas gracias por su tiempo. Recibirá la oferta en su email en las próximas 24 horas. ¡Que tenga un excelente día!"

REGLAS IMPORTANTES:
- NUNCA interrumpas al cliente
- Si el cliente se molesta, discúlpate y despídete educadamente
- Si hay ruido o no entiendes, pide que repitan amablemente
- Mantén las respuestas cortas y naturales (2-3 frases máximo)
- Solo pide el DNI si el cliente YA aceptó la oferta

RESPONDE SIEMPRE EN ESPAÑOL DE ESPAÑA.`;

/**
 * Inicializa la conexión con OpenAI
 */
async function initOpenAI() {
  const { OpenAI } = require('openai');
  return new OpenAI({ apiKey: CONFIG.openai.apiKey });
}

/**
 * Transcribe audio con Whisper
 */
async function transcribirAudio(audioBuffer) {
  const openai = await initOpenAI();
  
  // Guardar buffer como archivo temporal
  const tempFile = path.join(__dirname, 'temp_audio.webm');
  fs.writeFileSync(tempFile, audioBuffer);
  
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: CONFIG.openai.whisperModel,
      language: 'es'
    });
    
    return transcription.text;
  } finally {
    // Limpiar archivo temporal
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

/**
 * Genera respuesta con GPT-4
 */
async function generarRespuesta(mensajeCliente) {
  const openai = await initOpenAI();
  
  // Añadir mensaje a la conversación
  conversacion.mensajes.push({
    role: 'user',
    content: mensajeCliente
  });
  
  const response = await openai.chat.completions.create({
    model: CONFIG.openai.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversacion.mensajes
    ],
    temperature: 0.7,
    max_tokens: 150
  });
  
  const respuesta = response.choices[0].message.content;
  
  // Guardar respuesta en la conversación
  conversacion.mensajes.push({
    role: 'assistant',
    content: respuesta
  });
  
  return respuesta;
}

/**
 * Convierte texto a voz con ElevenLabs
 */
async function textToSpeech(texto) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${CONFIG.elevenlabs.voiceId}`,
    {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': CONFIG.elevenlabs.apiKey
      },
      body: JSON.stringify({
        text: texto,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.2,
          use_speaker_boost: true
        }
      })
    }
  );
  
  if (!response.ok) {
    throw new Error(`ElevenLabs error: ${response.status}`);
  }
  
  return await response.buffer();
}

/**
 * Reproduce audio por el dispositivo de salida (VB-CABLE)
 */
async function reproducirAudio(audioBuffer) {
  const tempFile = path.join(__dirname, 'temp_response.mp3');
  fs.writeFileSync(tempFile, audioBuffer);
  
  return new Promise((resolve, reject) => {
    // Usar ffplay (parte de ffmpeg) para reproducir al dispositivo VB-CABLE
    const ffplay = spawn('ffplay', [
      '-nodisp',
      '-autoexit',
      '-i', tempFile,
      '-f', 'waveaudio',
      CONFIG.audio.outputDevice
    ]);
    
    ffplay.on('close', (code) => {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      if (code === 0) resolve();
      else reject(new Error(`ffplay exited with code ${code}`));
    });
    
    ffplay.on('error', reject);
  });
}

/**
 * Flujo principal: procesa audio del cliente
 */
async function procesarAudioCliente(audioBuffer) {
  if (!conversacion.activa) {
    console.log('⚠️ No hay conversación activa');
    return null;
  }
  
  try {
    console.log('🎤 Transcribiendo audio...');
    const textoCliente = await transcribirAudio(audioBuffer);
    console.log(`👤 Cliente: ${textoCliente}`);
    
    console.log('🧠 Generando respuesta...');
    const respuesta = await generarRespuesta(textoCliente);
    console.log(`🤖 Agente: ${respuesta}`);
    
    console.log('🔊 Generando voz...');
    const audioRespuesta = await textToSpeech(respuesta);
    
    console.log('📢 Reproduciendo respuesta...');
    await reproducirAudio(audioRespuesta);
    
    return respuesta;
    
  } catch (error) {
    console.error('❌ Error procesando audio:', error);
    throw error;
  }
}

/**
 * Inicia una nueva conversación
 */
function iniciarConversacion(datosCliente = {}) {
  conversacion = {
    activa: true,
    clienteNombre: datosCliente.nombre || null,
    clienteTelefono: datosCliente.telefono || null,
    clienteDireccion: null,
    clienteDNI: null,
    interesado: false,
    mensajes: []
  };
  console.log('📞 Nueva conversación iniciada');
  return conversacion;
}

/**
 * Finaliza la conversación y guarda lead
 */
async function finalizarConversacion(resultado = 'pendiente') {
  conversacion.activa = false;
  
  // TODO: Guardar en Firebase
  const lead = {
    nombre: conversacion.clienteNombre,
    telefono: conversacion.clienteTelefono,
    direccion: conversacion.clienteDireccion,
    dni: conversacion.clienteDNI,
    interesado: conversacion.interesado,
    resultado: resultado,
    fecha: new Date().toISOString(),
    conversacion: conversacion.mensajes
  };
  
  console.log('📝 Conversación finalizada:', JSON.stringify(lead, null, 2));
  return lead;
}

/**
 * GUIONES PREDEFINIDOS para llamadas salientes
 */
const GUIONES = {
  bienvenida: async (nombre) => {
    const texto = `Hola ${nombre ? nombre + ', ' : ''}le llamo de Enerlux. ¿Podría dedicarme un minuto para hablar sobre cómo podemos ahorrarle hasta un 30% en su factura de luz?`;
    const audio = await textToSpeech(texto);
    await reproducirAudio(audio);
    return texto;
  },
  
  oferta: async () => {
    const texto = `Trabajamos con todas las compañías de España y encontramos la tarifa más barata para su consumo. El cambio es gratuito y no tiene que hacer ningún papeleo, nosotros nos encargamos de todo.`;
    const audio = await textToSpeech(texto);
    await reproducirAudio(audio);
    return texto;
  },
  
  cierre: async (nombre) => {
    const texto = `¡Perfecto ${nombre || ''}! Para enviarle su oferta personalizada, ¿podría confirmarme su dirección actual y su DNI para verificar la titularidad del contrato?`;
    const audio = await textToSpeech(texto);
    await reproducirAudio(audio);
    return texto;
  },
  
  despedida: async () => {
    const texto = `Muchas gracias por su tiempo. Si cambia de opinión, puede llamarnos al número que aparece en su pantalla. ¡Que tenga un excelente día!`;
    const audio = await textToSpeech(texto);
    await reproducirAudio(audio);
    return texto;
  }
};

// Exportar funciones principales
module.exports = {
  iniciarConversacion,
  finalizarConversacion,
  procesarAudioCliente,
  generarRespuesta,
  textToSpeech,
  reproducirAudio,
  GUIONES,
  CONFIG
};

// Si se ejecuta directamente
if (require.main === module) {
  console.log('📞 Enerlux Call Center IA');
  console.log('=========================');
  console.log('Configuración:');
  console.log('- Compañía:', CONFIG.company.name);
  console.log('- Servicio:', CONFIG.company.service);
  console.log('- Dispositivo entrada:', CONFIG.audio.inputDevice);
  console.log('- Dispositivo salida:', CONFIG.audio.outputDevice);
  console.log('');
  console.log('⚠️ Para usar, ejecuta: node server.js');
}