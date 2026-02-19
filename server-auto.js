/**
 * ENERLUX CALL CENTER IA - SERVIDOR AUTOMÁTICO
 * Sistema de llamadas con IA - 100% automático
 * Usa: Groq (IA) + Edge TTS (voz) + Whisper (escucha)
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Estado del sistema
let conversacionActiva = false;
let historialConversacion = [];
let clienteActual = null;
let grabacionProceso = null;
let silencioTimeout = null;

// Configuración
const CONFIG = {
  groq_key: process.env.GROQ_API_KEY,
  whisper_model: 'base', // tiny, base, small, medium, large
  idioma: 'es',
  sample_rate: 16000,
  silence_threshold: 0.5, // segundos de silencio para detectar fin de frase
  audio_input: 'CABLE Output (VB-Audio Virtual Cable)',
  audio_output: 'CABLE Input (VB-Audio Virtual Cable)',
  temp_dir: path.join(__dirname, 'temp'),
};

console.log('📞 ENERLUX CALL CENTER IA - SERVIDOR AUTOMÁTICO');
console.log('================================================');
console.log(`🔑 Groq: ${CONFIG.groq_key ? '✅ Configurado' : '❌ Falta API key'}`);
console.log(`🔊 TTS: Edge TTS (Microsoft - Gratis)`);
console.log(`👂 Escucha: Whisper (${CONFIG.whisper_model})`);
console.log(`🎤 Audio Input: ${CONFIG.audio_input}`);
console.log(`🔊 Audio Output: ${CONFIG.audio_output}`);
console.log('');

// Crear directorio temporal
if (!fs.existsSync(CONFIG.temp_dir)) {
  fs.mkdirSync(CONFIG.temp_dir, { recursive: true });
}

// ========================================
// WHISPER - TRANSCRIPCIÓN
// ========================================

async function transcribirConWhisper(audioPath) {
  return new Promise((resolve, reject) => {
    console.log('👂 Transcribiendo con Whisper...');
    
    const whisper = spawn('whisper', [
      audioPath,
      '--model', CONFIG.whisper_model,
      '--language', CONFIG.idioma,
      '--output_format', 'txt',
      '--output_dir', CONFIG.temp_dir,
      '--no_speech_threshold', '0.6',
    ]);

    let output = '';
    
    whisper.stderr.on('data', (data) => {
      output += data.toString();
    });

    whisper.on('close', (code) => {
      if (code !== 0) {
        console.log('⚠️ Whisper cerró con código:', code);
        resolve(null);
        return;
      }

      // Leer el archivo de transcripción
      const txtPath = audioPath.replace(/\.[^.]+$/, '.txt');
      try {
        if (fs.existsSync(txtPath)) {
          const transcripcion = fs.readFileSync(txtPath, 'utf-8').trim();
          console.log(`👂 Transcripción: "${transcripcion}"`);
          resolve(transcripcion);
        } else {
          resolve(null);
        }
      } catch (err) {
        console.log('⚠️ Error leyendo transcripción:', err.message);
        resolve(null);
      }
    });

    whisper.on('error', (err) => {
      console.log('❌ Error Whisper:', err.message);
      resolve(null);
    });
  });
}

// ========================================
// GRABACIÓN DE AUDIO DEL CLIENTE
// ========================================

async function grabarAudioCliente(duracionSegundos = 10) {
  const audioPath = path.join(CONFIG.temp_dir, 'cliente.wav');
  
  return new Promise((resolve) => {
    console.log(`🎤 Grabando audio por ${duracionSegundos}s...`);
    
    // Usar ffmpeg para grabar desde VB-CABLE
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'dshow',
      '-i', `audio=${CONFIG.audio_input}`,
      '-t', String(duracionSegundos),
      '-ar', String(CONFIG.sample_rate),
      '-ac', '1',
      '-y',
      audioPath
    ]);

    grabacionProceso = ffmpeg;

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(audioPath)) {
        console.log('✅ Audio grabado:', audioPath);
        resolve(audioPath);
      } else {
        console.log('⚠️ Error grabando audio');
        resolve(null);
      }
    });

    ffmpeg.on('error', (err) => {
      console.log('❌ Error ffmpeg:', err.message);
      resolve(null);
    });
  });
}

// ========================================
// DETECCIÓN DE VOZ (VAD SIMPLIFICADO)
// ========================================

async function detectarVoz() {
  // Grabar audio corto para detectar si hay voz
  const audioPath = await grabarAudioCliente(2);
  if (!audioPath) return false;

  const transcripcion = await transcribirConWhisper(audioPath);
  return transcripcion && transcripcion.length > 0;
}

// ========================================
// GROQ API - GENERACIÓN DE RESPUESTA
// ========================================

function generarPromptCliente(cliente) {
  if (!cliente) return '';
  
  const primerNombre = cliente.nombre ? cliente.nombre.split(' ')[0] : '';
  
  const datos = [];
  if (cliente.nombre) datos.push(`NOMBRE COMPLETO: ${cliente.nombre}`);
  if (primerNombre) datos.push(`PRIMER NOMBRE: ${primerNombre}`);
  if (cliente.direccion || cliente.dirección) datos.push(`DIRECCIÓN: ${cliente.direccion || cliente.dirección}`);
  if (cliente.codigo_postal || cliente.codigopostal || cliente.cp) datos.push(`CÓDIGO POSTAL: ${cliente.codigo_postal || cliente.codigopostal || cliente.cp}`);
  if (cliente.telefono || cliente.tel) datos.push(`TELÉFONO: ${cliente.telefono || cliente.tel}`);
  if (cliente.email || cliente.mail || cliente.correo) datos.push(`EMAIL: ${cliente.email || cliente.mail || cliente.correo}`);
  if (cliente.iban) datos.push(`IBAN: ****${cliente.iban.slice(-4)}`);
  if (cliente.dni) datos.push(`DNI: ******${cliente.dni.slice(-2)}`);
  
  return `\n\nDATOS DEL CLIENTE ACTUAL:\n${datos.join('\n')}`;
}

async function generarRespuestaGroq(mensajeUsuario) {
  historialConversacion.push({
    role: 'user',
    content: mensajeUsuario
  });

  console.log('🤖 Generando respuesta con Groq...');

  const systemPrompt = `Eres José, agente telefónico de Enerlux Soluciones, una ASESORÍA ENERGÉTICA en España.

IMPORTANTE: 
- Enerlux NO es comercializadora, es ASESORÍA que evalúa compañías (Endesa, Naturgy, Iberdrola, Gana Energía)
- NUNCA recites, HABLA natural
- VE PASO A PASO, espera respuesta en cada paso
${generarPromptCliente(clienteActual)}

FLUJO PASO A PASO:

PASO 1 - Si ya saludaste, ve al PASO 2
PASO 2 - Menciona 36% sobrecoste, pregunta cuánto paga
PASO 3 - Pregunta compañía actual
PASO 4 - Ofrece mejor precio (0,10€/kWh)
PASO 5 - Confirma datos con NOMBRE COMPLETO
PASO 6 - Pregunta papel o email
PASO 7 - Cierre: WhatsApp + email + 72h

REGLAS:
- Máximo 2-3 frases
- Espera respuesta antes de continuar
- Si rechaza, pregunta si conoce alguien interesado`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.groq_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          ...historialConversacion
        ],
        max_tokens: 150,
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
// EDGE TTS - TEXTO A VOZ
// ========================================

async function textoAVoz(texto) {
  const outputFile = path.join(CONFIG.temp_dir, 'output.mp3');
  
  return new Promise((resolve) => {
    const cmd = `edge-tts --text "${texto.replace(/"/g, '\\"')}" --voice es-ES-ElviraNeural --write-media "${outputFile}"`;
    
    exec(cmd, (error) => {
      if (error) {
        console.log('⚠️ Error TTS');
        resolve(null);
      } else {
        console.log(`✅ Audio generado: ${outputFile}`);
        resolve(outputFile);
      }
    });
  });
}

// ========================================
// REPRODUCIR AUDIO HACIA LA LLAMADA
// ========================================

async function reproducirAudio(audioPath) {
  return new Promise((resolve) => {
    console.log('🔊 Reproduciendo audio hacia la llamada...');
    
    // Usar ffmpeg para reproducir por VB-CABLE
    const ffmpeg = spawn('ffmpeg', [
      '-i', audioPath,
      '-f', 'dshow',
      `audio=${CONFIG.audio_output}`
    ]);

    ffmpeg.on('close', () => {
      console.log('✅ Audio enviado');
      resolve();
    });

    ffmpeg.on('error', (err) => {
      console.log('⚠️ Error reproduciendo:', err.message);
      resolve();
    });
  });
}

// ========================================
// CSV PARSER
// ========================================

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

function parseCSV(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  
  const clientes = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Formato simple: "1465. NOMBRE - +34TELEFONO"
    const matchSimple = line.match(/^(\d+)\.\s*(.+?)\s*-\s*(\+?\d+)$/);
    if (matchSimple) {
      clientes.push({
        id: matchSimple[1],
        nombre: matchSimple[2].trim(),
        telefono: matchSimple[3].trim()
      });
      continue;
    }
    
    // Formato CSV completo
    const values = parseCSVLine(line);
    
    if (values.length >= 4) {
      if (values[0].toLowerCase().includes('id') || 
          values[1].toLowerCase().includes('dni')) {
        continue;
      }
      
      clientes.push({
        id: values[0] || '',
        dni: (values[1] || '').replace(/\s+/g, '').toUpperCase(),
        nombre: values[2] || '',
        telefono: (values[3] || '').replace(/\s+/g, ''),
        email: (values[4] || '').trim().toUpperCase(),
        direccion: values[5] || '',
        codigo_postal: values[6] || ''
      });
    }
  }
  
  return clientes;
}

// ========================================
// LOOP DE LLAMADA AUTOMÁTICA
// ========================================

async function llamadaAutomatica(cliente) {
  clienteActual = cliente;
  historialConversacion = [];
  conversacionActiva = true;

  console.log('\n📞 ═══════════════════════════════════');
  console.log(`📞 LLAMANDO A: ${cliente.nombre}`);
  console.log(`📞 TELÉFONO: ${cliente.telefono}`);
  console.log('📞 ═══════════════════════════════════\n');

  // PASO 1: Saludo inicial
  const primerNombre = (cliente.nombre || 'usted').split(' ')[0];
  const saludo = `Hola, buenos días. ¿Hablo con ${primerNombre}? Le llamo del Departamento de Incidencias de Enerlux Soluciones por su suministro en ${cliente.direccion || 'su dirección'}.`;
  
  historialConversacion.push({ role: 'assistant', content: saludo });
  console.log(`🗣️ IA: "${saludo}"`);
  
  const audioSaludo = await textoAVoz(saludo);
  if (audioSaludo) await reproducirAudio(audioSaludo);

  // PASO 2: Loop de conversación
  let intentosSilencio = 0;
  const maxIntentosSilencio = 3;

  while (conversacionActiva && intentosSilencio < maxIntentosSilencio) {
    // Grabar al cliente
    const audioCliente = await grabarAudioCliente(8);
    
    if (!audioCliente) {
      intentosSilencio++;
      console.log(`⚠️ No se captó audio (${intentosSilencio}/${maxIntentosSilencio})`);
      continue;
    }

    // Transcribir
    const transcripcion = await transcribirConWhisper(audioCliente);
    
    if (!transcripcion || transcripcion.trim().length === 0) {
      intentosSilencio++;
      console.log(`⚠️ Silencio detectado (${intentosSilencio}/${maxIntentosSilencio})`);
      continue;
    }

    intentosSilencio = 0;

    // Detectar despedida
    if (transcripcion.toLowerCase().match(/\b(adiós|chao|hasta luego|no me interesa|colgar)\b/)) {
      console.log('📞 Cliente terminó la llamada');
      conversacionActiva = false;
      break;
    }

    // Generar respuesta
    const respuesta = await generarRespuestaGroq(transcripcion);
    
    // Convertir a voz y reproducir
    const audioRespuesta = await textoAVoz(respuesta);
    if (audioRespuesta) await reproducirAudio(audioRespuesta);

    // Detectar cierre
    if (historialConversacion.length > 10 || 
        respuesta.toLowerCase().includes('hasta luego') ||
        respuesta.toLowerCase().includes('su asesor asignado')) {
      console.log('✅ Llamada completada');
      conversacionActiva = false;
    }
  }

  console.log('\n📞 Llamada finalizada');
  console.log('📞 ═══════════════════════════════════\n');
}

// ========================================
// MODO LLAMADAS MÚLTIPLES
// ========================================

async function modoLlamadasAutomaticas(csvPath) {
  if (!fs.existsSync(csvPath)) {
    console.log(`❌ ERROR: No existe ${csvPath}`);
    return;
  }

  const clientes = parseCSV(csvPath);
  console.log(`📋 ${clientes.length} clientes cargados\n`);

  if (clientes.length === 0) {
    console.log('❌ No hay clientes');
    return;
  }

  console.log('🚀 INICIANDO LLAMADAS AUTOMÁTICAS...\n');

  for (let i = 0; i < clientes.length; i++) {
    console.log(`\n📊 Progreso: ${i + 1}/${clientes.length}`);
    await llamadaAutomatica(clientes[i]);
    
    // Pausa entre llamadas
    if (i < clientes.length - 1) {
      console.log('⏳ Esperando 5 segundos antes de la siguiente llamada...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log('🎉 TODAS LAS LLAMADAS COMPLETADAS');
}

// ========================================
// INICIAR
// ========================================

const args = process.argv.slice(2);
const csvIndex = args.findIndex(a => a === '--csv' || a === '-c');

if (csvIndex !== -1 && args[csvIndex + 1]) {
  modoLlamadasAutomaticas(args[csvIndex + 1]);
} else if (args.includes('--help') || args.includes('-h')) {
  console.log('📝 USO:');
  console.log('  node server-auto.js --csv clientes.csv');
  console.log('');
  console.log('⚡ Sistema automático completo:');
  console.log('  - Carga clientes del CSV');
  console.log('  - Escucha al cliente (Whisper)');
  console.log('  - Genera respuestas (Groq)');
  console.log('  - Responde con voz (Edge TTS)');
  console.log('');
} else {
  console.log('📝 USO:');
  console.log('  node server-auto.js --csv clientes.csv');
  console.log('  node server-auto.js --help');
  console.log('');
}