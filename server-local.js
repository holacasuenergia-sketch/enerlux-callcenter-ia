/**
 * ENERLUX CALL CENTER IA - SERVIDOR LOCAL (VB-CABLE + ZADARMA)
 * Sistema de llamadas con IA - versión GRATUITA
 * Usa: Gemini (gratis) + Edge TTS (gratis)
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Estado del sistema
let conversacionActiva = false;
let historialConversacion = [];

// Configuración
const CONFIG = {
  gemini_key: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  use_edge_tts: true, // Edge TTS es gratis
  audio_input: 'CABLE Output (VB-Audio Virtual Cable)',
  audio_output: 'CABLE Input (VB-Audio Virtual Cable)',
  idioma: 'es'
};

console.log('📞 ENERLUX CALL CENTER IA - Servidor Local (GRATIS)');
console.log('===================================================');
console.log(`🔑 Gemini: ${CONFIG.gemini_key ? '✅ Configurado' : '❌ Falta API key'}`);
console.log(`🔊 Voz: Edge TTS (Microsoft - Gratis)`);
console.log(`🎧 Audio Input: ${CONFIG.audio_input}`);
console.log(`🎧 Audio Output: ${CONFIG.audio_output}`);
console.log('');

// ========================================
// FUNCIONES DE AUDIO
// ========================================

async function grabarAudio(duracionMs = 5000) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(__dirname, 'temp', 'input.wav');
    
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
    }

    const cmd = `ffmpeg -y -f dshow -i audio="${CONFIG.audio_input}" -t ${duracionMs/1000} -acodec pcm_s16le -ar 16000 -ac 1 "${outputFile}"`;
    
    console.log(`🎤 Grabando audio por ${duracionMs/1000}s...`);
    
    exec(cmd, (error, stdout, stderr) => {
      if (error && !fs.existsSync(outputFile)) {
        const cmd2 = `ffmpeg -y -f wasapi -i audio_output_default -t ${duracionMs/1000} -acodec pcm_s16le -ar 16000 -ac 1 "${outputFile}"`;
        exec(cmd2, (err2) => {
          if (err2) {
            console.log('⚠️ Error grabando');
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

async function reproducirAudio(archivoAudio) {
  return new Promise((resolve, reject) => {
    const cmd = `ffplay -autoexit -nodisp "${archivoAudio}"`;
    console.log(`🔊 Reproduciendo audio...`);
    exec(cmd, (error) => {
      if (error) {
        const psCmd = `powershell -c (New-Object Media.SoundPlayer "${archivoAudio}").PlaySync()`;
        exec(psCmd, () => resolve());
      } else {
        resolve();
      }
    });
  });
}

// ========================================
// GEMINI (GRATIS)
// ========================================

async function generarRespuestaGemini(mensajeUsuario) {
  historialConversacion.push({
    role: 'user',
    content: mensajeUsuario
  });

  console.log('🤖 Generando respuesta con Gemini...');

  // Construir historial para Gemini
  const contents = [];
  for (const msg of historialConversacion) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.gemini_key}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: contents,
      systemInstruction: {
        parts: [{
          text: `Eres un agente telefónico de Enerlux, empresa de cambio de compañía eléctrica en España.

Tu objetivo es convencer al cliente de cambiarse a Enerlux para ahorrar en su factura de luz.

REGLAS:
- Sé amable pero persuasivo
- Responde de forma BREVE (máximo 2 frases cortas)
- Si el cliente está interesado, pide su número de cuenta bancaria IBAN
- Si el cliente no está interesado, pregunta si conoce a alguien que pueda estarlo
- Si el cliente tiene preguntas, respóndelas claramente

INFORMACIÓN DE ENERLUX:
- Ahorro garantizado del 15-20% en factura mensual
- Sin permanencia
- Cambio gratis
- 100% energía renovable
- Precios congelados por 12 meses

Responde SIEMPRE en español, de forma natural y conversacional.`
        }]
      },
      generationConfig: {
        maxOutputTokens: 100,
        temperature: 0.7
      }
    })
  });

  const data = await response.json();
  
  if (!response.ok || !data.candidates || !data.candidates[0]) {
    console.log('❌ Error Gemini:', JSON.stringify(data));
    return "Disculpe, podría repetir eso por favor?";
  }

  const respuesta = data.candidates[0].content.parts[0].text;

  historialConversacion.push({
    role: 'assistant',
    content: respuesta
  });

  console.log(`🤖 Respuesta: "${respuesta}"`);
  return respuesta;
}

// ========================================
// EDGE TTS (GRATIS - Microsoft)
// ========================================

async function textoAVozEdge(texto) {
  console.log('🔊 Convirtiendo a voz con Edge TTS (gratis)...');
  
  if (!fs.existsSync(path.join(__dirname, 'temp'))) {
    fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
  }
  
  const outputFile = path.join(__dirname, 'temp', 'output.mp3');
  
  // Edge TTS usa la voz de Microsoft en español
  // Voz: es-ES-ElviraNeural (mujer española natural)
  const cmd = `edge-tts --text "${texto.replace(/"/g, '\\"')}" --voice es-ES-ElviraNeural --write-media "${outputFile}"`;
  
  return new Promise((resolve, reject) => {
    exec(cmd, (error) => {
      if (error) {
        console.log('⚠️ Error con Edge TTS, intentando alternativa...');
        // Alternativa: usar PowerShell con SAPI
        const psCmd = `powershell -Command "Add-Type -AssemblyName System.Speech; $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speak.SelectVoice('Microsoft Helena'); $speak.Speak('${texto.replace(/'/g, "''")}')"`;
        exec(psCmd, () => resolve(null));
      } else {
        console.log(`✅ Audio generado: ${outputFile}`);
        resolve(outputFile);
      }
    });
  });
}

// Alternativa con PowerShell SAPI (siempre disponible en Windows)
async function textoAVozSAPI(texto) {
  console.log('🔊 Usando voz de Windows (SAPI)...');
  
  // Escapar comillas para PowerShell
  const textoEscapado = texto.replace(/'/g, "''").replace(/"/g, '\\"');
  
  return new Promise((resolve) => {
    const psCmd = `powershell -Command "Add-Type -AssemblyName System.Speech; $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speak.Speak('${textoEscapado}')"`;
    exec(psCmd, (error) => {
      if (error) {
        console.log('⚠️ Error con SAPI');
      }
      resolve(null);
    });
  });
}

// ========================================
// MODO INTERACTIVO
// ========================================

async function modoInteractivo() {
  const readline = await import('readline');
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

  // Verificar Gemini API key
  if (!CONFIG.gemini_key) {
    console.log('❌ ERROR: Falta GEMINI_API_KEY en el archivo .env');
    console.log('   Crear API key gratis en: https://aistudio.google.com/app/apikey');
    console.log('   Luego añadir al archivo .env:');
    console.log('   GEMINI_API_KEY=tu_api_key_aqui');
    console.log('');
    rl.close();
    return;
  }

  const saludo = "Hola, le llamo de Enerlux. ¿Podría hablar un momento sobre su factura de luz?";
  console.log(`🗣️ IA: "${saludo}"`);
  
  // Generar audio del saludo
  const audioSaludo = await textoAVozEdge(saludo);
  if (audioSaludo) {
    console.log(`🔊 Audio guardado en: ${audioSaludo}`);
  }

  const preguntar = () => {
    rl.question('👤 Cliente: ', async (input) => {
      if (input.toLowerCase() === 'salir') {
        console.log('👋 ¡Hasta luego!');
        rl.close();
        return;
      }

      if (!input.trim()) {
        preguntar();
        return;
      }

      const respuesta = await generarRespuestaGemini(input);
      console.log(`🗣️ IA: "${respuesta}"`);

      const audio = await textoAVozEdge(respuesta);
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

const args = process.argv.slice(2);
if (args.includes('--interactivo') || args.includes('-i')) {
  modoInteractivo();
} else if (args.includes('--llamar') || args.includes('-l')) {
  console.log('📞 Modo llamada con audio real');
  console.log('⚠️ Asegúrate de que Zadarma está conectado');
  modoInteractivo();
} else {
  console.log('📝 USO:');
  console.log('');
  console.log('  node server-local.js --interactivo  → Prueba escribiendo');
  console.log('  node server-local.js --llamar       → Con audio real (VB-CABLE)');
  console.log('');
  console.log('🔑 CONFIGURACIÓN:');
  console.log('  Crear archivo .env con:');
  console.log('  GEMINI_API_KEY=tu_api_key');
  console.log('  (Obtener gratis en: https://aistudio.google.com/app/apikey)');
  console.log('');
  modoInteractivo();
}