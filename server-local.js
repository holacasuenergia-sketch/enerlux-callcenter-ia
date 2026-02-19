/**
 * ENERLUX CALL CENTER IA - SERVIDOR LOCAL (VB-CABLE + ZADARMA)
 * Sistema de llamadas con IA - versión GRATUITA
 * Usa: Groq (gratis, muy rápido) + Edge TTS (gratis)
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
  groq_key: process.env.GROQ_API_KEY,
  use_edge_tts: true,
  audio_input: 'CABLE Output (VB-Audio Virtual Cable)',
  audio_output: 'CABLE Input (VB-Audio Virtual Cable)',
  idioma: 'es'
};

console.log('📞 ENERLUX CALL CENTER IA - Servidor Local (GRATIS)');
console.log('===================================================');
console.log(`🔑 Groq: ${CONFIG.groq_key ? '✅ Configurado' : '❌ Falta API key'}`);
console.log(`🔊 Voz: Edge TTS (Microsoft - Gratis)`);
console.log(`🎧 Audio Input: ${CONFIG.audio_input}`);
console.log(`🎧 Audio Output: ${CONFIG.audio_output}`);
console.log('');

// ========================================
// GROQ API (GRATIS - LLaMA/Mixtral)
// ========================================

async function generarRespuestaGroq(mensajeUsuario) {
  historialConversacion.push({
    role: 'user',
    content: mensajeUsuario
  });

  console.log('🤖 Generando respuesta con Groq (LLaMA 3.1)...');

  const messages = [
    {
      role: 'system',
      content: `Eres un agente telefónico de Enerlux, empresa de cambio de compañía eléctrica en España.

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
    },
    ...historialConversacion
  ];

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.groq_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: messages,
        max_tokens: 100,
        temperature: 0.7
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.log('❌ Error Groq:', JSON.stringify(data));
      return "Disculpe, podría repetir eso por favor?";
    }

    const respuesta = data.choices[0].message.content;

    historialConversacion.push({
      role: 'assistant',
      content: respuesta
    });

    console.log(`🤖 Respuesta: "${respuesta}"`);
    return respuesta;
  } catch (error) {
    console.log('❌ Error:', error.message);
    return "Disculpe, podría repetir eso por favor?";
  }
}

// ========================================
// EDGE TTS (GRATIS - Microsoft)
// ========================================

async function textoAVozEdge(texto) {
  console.log('🔊 Convirtiendo a voz con Edge TTS...');
  
  if (!fs.existsSync(path.join(__dirname, 'temp'))) {
    fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
  }
  
  const outputFile = path.join(__dirname, 'temp', 'output.mp3');
  const cmd = `edge-tts --text "${texto.replace(/"/g, '\\"')}" --voice es-ES-ElviraNeural --write-media "${outputFile}"`;
  
  return new Promise((resolve) => {
    exec(cmd, (error) => {
      if (error) {
        console.log('⚠️ Error Edge TTS, fallback a reproducir directo...');
        // Reproducir sin guardar archivo
        exec(`edge-tts --text "${texto.replace(/"/g, '\\"')}" --voice es-ES-ElviraNeural | ffplay -autoexit -nodisp -i pipe:0`, () => resolve(null));
      } else {
        console.log(`✅ Audio generado: ${outputFile}`);
        resolve(outputFile);
      }
    });
  });
}

// Alternativa con SAPI (Windows)
async function textoAVozSAPI(texto) {
  const textoEscapado = texto.replace(/'/g, "''");
  return new Promise((resolve) => {
    exec(`powershell -Command "Add-Type -AssemblyName System.Speech; $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speak.Speak('${textoEscapado}')"`, () => resolve());
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
  console.log('🎮 MODO INTERACTIVO');
  console.log('🎮 Escribe lo que diría el cliente');
  console.log('🎮 Escribe "salir" para terminar');
  console.log('🎮 ═══════════════════════════════════');
  console.log('');

  if (!CONFIG.groq_key) {
    console.log('❌ ERROR: Falta GROQ_API_KEY en el archivo .env');
    console.log('   Crear API key gratis en: https://console.groq.com');
    console.log('');
    rl.close();
    return;
  }

  const saludo = "Hola, le llamo de Enerlux. ¿Podría hablar un momento sobre su factura de luz?";
  console.log(`🗣️ IA: "${saludo}"`);
  
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

      const respuesta = await generarRespuestaGroq(input);
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
  modoInteractivo();
} else {
  console.log('📝 USO:');
  console.log('  node server-local.js --interactivo  → Prueba escribiendo');
  console.log('  node server-local.js --llamar       → Con audio real');
  console.log('');
  modoInteractivo();
}
