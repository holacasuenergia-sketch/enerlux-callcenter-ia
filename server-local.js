/**
 * ENERLUX CALL CENTER IA - SERVIDOR LOCAL (VB-CABLE + ZADARMA)
 * Sistema de llamadas con IA usando VB-CABLE para audio local
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const wav = require('wav');
require('dotenv').config();

// Estado del sistema
let conversacionActiva = false;
let historialConversacion = [];

// Configuración
const CONFIG = {
  openai_key: process.env.OPENAI_API_KEY,
  elevenlabs_key: process.env.ELEVENLABS_API_KEY,
  elevenlabs_voice_id: '21m00Tcm4TlvDq8ikWAM', // Rachel - voz natural
  audio_input: 'CABLE Output (VB-Audio Virtual Cable)', // Micrófono virtual
  audio_output: 'CABLE Input (VB-Audio Virtual Cable)', // Altavoz virtual
  idioma: 'es'
};

console.log('📞 ENERLUX CALL CENTER IA - Servidor Local');
console.log('==========================================');
console.log(`🔑 OpenAI: ${CONFIG.openai_key ? '✅ Configurado' : '❌ Falta'}`);
console.log(`🔑 ElevenLabs: ${CONFIG.elevenlabs_key ? '✅ Configurado' : '❌ Falta'}`);
console.log(`🎧 Audio Input: ${CONFIG.audio_input}`);
console.log(`🎧 Audio Output: ${CONFIG.audio_output}`);
console.log('');

// ========================================
// FUNCIONES DE AUDIO
// ========================================

/**
 * Grabar audio del micrófono virtual (CABLE Output)
 * El softphone Zadarma envía el audio del cliente aquí
 */
async function grabarAudio(duracionMs = 5000) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(__dirname, 'temp', 'input.wav');
    
    // Crear carpeta temp si no existe
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
    }

    // Usar ffmpeg para grabar del dispositivo VB-CABLE
    // En Windows, necesitamos usar dshow o wasapi
    const cmd = `ffmpeg -y -f dshow -i audio="${CONFIG.audio_input}" -t ${duracionMs/1000} -acodec pcm_s16le -ar 16000 -ac 1 "${outputFile}"`;
    
    console.log(`🎤 Grabando audio por ${duracionMs/1000}s...`);
    
    exec(cmd, (error, stdout, stderr) => {
      if (error && !fs.existsSync(outputFile)) {
        // Intentar alternativo con wasapi
        const cmd2 = `ffmpeg -y -f wasapi -i audio_output_default -t ${duracionMs/1000} -acodec pcm_s16le -ar 16000 -ac 1 "${outputFile}"`;
        exec(cmd2, (err2) => {
          if (err2) {
            console.log('⚠️ Error grabando, usando simulación');
            resolve(null);
          } else {
            resolve(outputFile);
          }
        });
      } else {
        resolve(outputFile);
      }
    });
  });
}

/**
 * Reproducir audio por el altavoz virtual (CABLE Input)
 * El softphone Zadarma recibe este audio y lo envía al cliente
 */
async function reproducirAudio(archivoAudio) {
  return new Promise((resolve, reject) => {
    // Usar ffplay o Windows Media Player
    const cmd = `ffplay -autoexit -nodisp "${archivoAudio}"`;
    
    console.log(`🔊 Reproduciendo audio...`);
    
    exec(cmd, (error) => {
      if (error) {
        // Alternativo: usar PowerShell
        const psCmd = `powershell -c (New-Object Media.SoundPlayer "${archivoAudio}").PlaySync()`;
        exec(psCmd, () => resolve());
      } else {
        resolve();
      }
    });
  });
}

// ========================================
// FUNCIONES DE IA
// ========================================

/**
 * Transcribir audio con OpenAI Whisper
 */
async function transcribirAudio(archivoAudio) {
  if (!archivoAudio || !fs.existsSync(archivoAudio)) {
    return null;
  }

  console.log('📝 Transcribiendo con Whisper...');
  
  const audioBuffer = fs.readFileSync(archivoAudio);
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer]), 'audio.wav');
  formData.append('model', 'whisper-1');
  formData.append('language', CONFIG.idioma);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.openai_key}`
    },
    body: formData
  });

  if (!response.ok) {
    console.log('⚠️ Error en Whisper, usando texto de prueba');
    return "Hola, me interesa cambiar de compañía eléctrica";
  }

  const data = await response.json();
  console.log(`📝 Transcripción: "${data.text}"`);
  return data.text;
}

/**
 * Generar respuesta con GPT-4
 */
async function generarRespuesta(mensajeUsuario) {
  historialConversacion.push({
    role: 'user',
    content: mensajeUsuario
  });

  console.log('🤖 Generando respuesta con GPT-4...');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.openai_key}`
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
- Responde de forma BREVE (máximo 2 frases cortas, ideal para telefonía)
- Si el cliente está interesado, pide su número de cuenta bancaria IBAN
- Si el cliente no está interesado, pregunta si conoce a alguien que pueda estarlo
- Si el cliente tiene preguntas, respóndelas claramente

INFORMACIÓN DE ENERLUX:
- Ahorro garantizado del 15-20% en factura mensual
- Sin permanencia
- Cambio gratis
- 100% energía renovable
- Precios congelados por 12 meses

Responde SIEMPRE en español, de forma natural y conversacional.
IMPORTANTE: Tus respuestas deben ser CORTAS porque serán convertidas a voz.`
        },
        ...historialConversacion.slice(-10)
      ],
      max_tokens: 100
    })
  });

  const data = await response.json();
  const respuesta = data.choices[0].message.content;

  historialConversacion.push({
    role: 'assistant',
    content: respuesta
  });

  console.log(`🤖 Respuesta: "${respuesta}"`);
  return respuesta;
}

/**
 * Convertir texto a voz con ElevenLabs
 */
async function textoAVoz(texto) {
  console.log('🔊 Convirtiendo a voz con ElevenLabs...');

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${CONFIG.elevenlabs_voice_id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': CONFIG.elevenlabs_key
    },
    body: JSON.stringify({
      text: texto,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.5,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    console.log('⚠️ Error en ElevenLabs, usando fallback');
    return null;
  }

  const audioBuffer = await response.buffer();
  const outputFile = path.join(__dirname, 'temp', 'output.mp3');
  fs.writeFileSync(outputFile, audioBuffer);
  
  console.log(`✅ Audio generado: ${outputFile}`);
  return outputFile;
}

// ========================================
// BUCLE PRINCIPAL DE CONVERSACIÓN
// ========================================

async function iniciarConversacion() {
  console.log('');
  console.log('🎯 ═══════════════════════════════════');
  console.log('📞 CONVERSACIÓN INICIADA');
  console.log('🎯 ═══════════════════════════════════');
  console.log('');
  
  conversacionActiva = true;
  historialConversacion = [];

  // Mensaje inicial
  const saludoInicial = "Hola, le llamo de Enerlux. ¿Podría hablar un momento sobre su factura de luz? Estamos ofreciendo un ahorro garantizado del 20 por ciento.";
  
  console.log(`🗣️ IA: "${saludoInicial}"`);
  
  const audioSaludo = await textoAVoz(saludoInicial);
  if (audioSaludo) {
    await reproducirAudio(audioSaludo);
  }

  // Bucle de conversación
  while (conversacionActiva) {
    console.log('');
    console.log('⏳ Escuchando al cliente...');
    
    // Grabar audio del cliente
    const audioFile = await grabarAudio(5000);
    
    // Transcribir
    const textoCliente = await transcribirAudio(audioFile);
    
    if (!textoCliente || textoCliente.trim() === '') {
      console.log('⚠️ No se detectó voz, preguntando si está ahí...');
      const noVoz = await textoAVoz("¿Hola? ¿Me escucha?");
      if (noVoz) await reproducirAudio(noVoz);
      continue;
    }

    console.log(`👤 Cliente: "${textoCliente}"`);

    // Verificar si termina la conversación
    if (textoCliente.toLowerCase().includes('adiós') || 
        textoCliente.toLowerCase().includes('no me interesa') ||
        textoCliente.toLowerCase().includes('cuelgo')) {
      console.log('📞 El cliente quiere terminar...');
      const despedida = await textoAVoz("Entendido, gracias por su tiempo. Que tenga un buen día.");
      if (despedida) await reproducirAudio(despedida);
      conversacionActiva = false;
      break;
    }

    // Generar respuesta
    const respuesta = await generarRespuesta(textoCliente);
    
    // Convertir a voz
    const audioRespuesta = await textoAVoz(respuesta);
    if (audioRespuesta) {
      await reproducirAudio(audioRespuesta);
    }
  }

  console.log('');
  console.log('✅ Conversación finalizada');
}

// ========================================
// MODO INTERACTIVO (para pruebas)
// ========================================

async function modoInteractivo() {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('');
  console.log('🎮 ═══════════════════════════════════');
  console.log('🎮 MODO INTERACTIVO (pruebas sin audio)');
  console.log('🎮 Escribe lo que diría el cliente');
  console.log('🎮 Escribe "salir" para terminar');
  console.log('🎮 ═══════════════════════════════════');
  console.log('');

  // Saludo inicial
  const saludo = "Hola, le llamo de Enerlux. ¿Podría hablar un momento sobre su factura de luz?";
  console.log(`🗣️ IA: "${saludo}"`);
  historialConversacion.push({ role: 'assistant', content: saludo });

  const preguntar = () => {
    rl.question('👤 Cliente: ', async (input) => {
      if (input.toLowerCase() === 'salir') {
        console.log('👋 ¡Hasta luego!');
        rl.close();
        return;
      }

      const respuesta = await generarRespuesta(input);
      console.log(`🗣️ IA: "${respuesta}"`);

      // Generar audio también
      const audio = await textoAVoz(respuesta);
      if (audio) {
        console.log(`🔊 Audio guardado en: ${audio}`);
      }

      preguntar();
    });
  };

  preguntar();
}

// ========================================
// INICIAR
// ========================================

// Detectar modo
const args = process.argv.slice(2);
if (args.includes('--interactivo') || args.includes('-i')) {
  modoInteractivo();
} else if (args.includes('--llamar') || args.includes('-l')) {
  iniciarConversacion();
} else {
  console.log('📝 USO:');
  console.log('');
  console.log('  node server-local.js --interactivo  → Prueba escribiendo');
  console.log('  node server-local.js --llamar       → Con audio real (VB-CABLE)');
  console.log('');
  console.log('⚡ Iniciando modo interactivo por defecto...');
  console.log('');
  modoInteractivo();
}