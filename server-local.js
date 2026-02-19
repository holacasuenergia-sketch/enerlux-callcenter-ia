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
let clienteActual = null;

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
// LEER CSV DE CLIENTES
// ========================================

// Parser CSV que maneja comillas correctamente
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
  let headerFound = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Formato simple: "1465. JOSE TADEO HIDALGO LOPEZ - +34619739311"
    const matchSimple = line.match(/^(\d+)\.\s*(.+?)\s*-\s*(\+?\d+)$/);
    if (matchSimple) {
      clientes.push({
        id: matchSimple[1],
        nombre: matchSimple[2].trim(),
        telefono: matchSimple[3].trim()
      });
      continue;
    }
    
    // Formato CSV con comas (maneja comillas)
    const values = parseCSVLine(line);
    
    if (values.length >= 4) {
      // Detectar si la primera línea es header
      if (values[0].toLowerCase().includes('id') || 
          values[1].toLowerCase().includes('dni') ||
          values.some(v => v.toLowerCase().includes('telefono') || v.toLowerCase().includes('phone'))) {
        headerFound = true;
        continue;
      }
      
      const cliente = {
        id: values[0] || '',
        dni: (values[1] || '').replace(/\s+/g, '').toUpperCase(), // Limpiar DNI
        nombre: values[2] || '',
        telefono: (values[3] || '').replace(/\s+/g, ''), // Limpiar teléfono
        email: (values[4] || '').trim().toUpperCase(),
        direccion: values[5] || '',
        codigo_postal: values[6] || ''
      };
      
      // Validar que tenga nombre o teléfono
      if (cliente.nombre || cliente.telefono) {
        clientes.push(cliente);
      }
    }
  }
  
  return clientes;
}

function mostrarCliente(cliente) {
  console.log('\n📋 ═══════════════════════════════════');
  console.log('📋 DATOS DEL CLIENTE:');
  console.log(`📋 Nombre: ${cliente.nombre || 'N/A'}`);
  console.log(`📋 Dirección: ${cliente.direccion || cliente.dirección || 'N/A'}`);
  console.log(`📋 Código Postal: ${cliente.codigo_postal || cliente.codigopostal || cliente.cp || 'N/A'}`);
  console.log(`📋 Teléfono: ${cliente.telefono || cliente.tel || 'N/A'}`);
  console.log(`📋 Email: ${cliente.email || cliente.mail || cliente.correo || 'N/A'}`);
  if (cliente.iban) {
    console.log(`📋 IBAN: ****${cliente.iban.slice(-4)}`);
  }
  if (cliente.dni) {
    console.log(`📋 DNI: ******${cliente.dni.slice(-2)}`);
  }
  console.log('📋 ═══════════════════════════════════\n');
}

function generarPromptCliente(cliente) {
  if (!cliente) return '';
  
  // Extraer solo el primer nombre
  const primerNombre = cliente.nombre ? cliente.nombre.split(' ')[0] : '';
  
  const datos = [];
  if (cliente.nombre) datos.push(`NOMBRE COMPLETO: ${cliente.nombre}`);
  if (primerNombre) datos.push(`PRIMER NOMBRE: ${primerNombre} (úSALO para dirigirte al cliente)`);
  if (cliente.direccion || cliente.dirección) datos.push(`DIRECCIÓN: ${cliente.direccion || cliente.dirección}`);
  if (cliente.codigo_postal || cliente.codigopostal || cliente.cp) datos.push(`CÓDIGO POSTAL: ${cliente.codigo_postal || cliente.codigopostal || cliente.cp}`);
  if (cliente.telefono || cliente.tel) datos.push(`TELÉFONO: ${cliente.telefono || cliente.tel}`);
  if (cliente.email || cliente.mail || cliente.correo) datos.push(`EMAIL: ${cliente.email || cliente.mail || cliente.correo}`);
  if (cliente.iban) datos.push(`IBAN: ****${cliente.iban.slice(-4)} (pedírselo al cliente para confirmar)`);
  if (cliente.dni) datos.push(`DNI: ******${cliente.dni.slice(-2)}`);
  
  // Nota si falta IBAN
  if (!cliente.iban) {
    datos.push(`IBAN: (pedir al cliente durante la llamada)`);
  }
  
  return `\n\nDATOS DEL CLIENTE ACTUAL (úsalos en la conversación):
${datos.join('\n')}`;
}

// ========================================
// GROQ API (GRATIS - LLaMA/Mixtral)
// ========================================

async function generarRespuestaGroq(mensajeUsuario) {
  historialConversacion.push({
    role: 'user',
    content: mensajeUsuario
  });

  console.log('🤖 Generando respuesta con Groq (LLaMA 3.1)...');

  const systemPrompt = `Eres José, agente telefónico de Enerlux Soluciones, una ASESORÍA ENERGÉTICA en España.

IMPORTANTE: 
- Enerlux NO es comercializadora, es ASESORÍA que evalúa compañías (Endesa, Naturgy, Iberdrola, Gana Energía) y encuentra el mejor precio
- NUNCA recites el speech, HABLA de forma natural como un humano real
- USA los datos del cliente si están disponibles
- VE PASO A PASO, espera la respuesta del cliente antes de continuar al siguiente paso
- NO adelantes información, NO saltes pasos
${generarPromptCliente(clienteActual)}

FLUJO DE LLAMADA PASO A PASO (espera respuesta en cada uno):

PASO 1 - SALUDO:
- Si ya saludaste en el mensaje inicial, NO repitas el saludo
- Si el cliente confirmó que es la persona, ve al PASO 2

PASO 2 - MOTIVO DE LA LLAMADA:
- Menciona el 36% de sobrecoste detectado en su factura
- Pregunta cuánto paga aproximadamente de factura
- ESPERA su respuesta

PASO 3 - COMPAÑÍA ACTUAL:
- Pregunta con qué compañía de luz está actualmente
- ESPERA su respuesta

PASO 4 - OFERTA:
- Ofrece el mejor precio (0,10€/kWh) evaluando las compañías de su zona
- Menciona que como asesoría evaluamos Endesa, Naturgy, Iberdrola, etc.
- ESPERA su reacción/pregunta

PASO 5 - CONFIRMACIÓN DE DATOS:
- Confirma sus datos usando NOMBRE COMPLETO (ej: "Su nombre completo es Sonia Cenador Prieto, ¿correcto?")
- Confirma dirección, email, etc.
- ESPERA confirmación

PASO 6 - PRIMER CIERRE (factura):
- Pregunta si prefiere recibir la factura en papel o por email
- ESPERA su respuesta

PASO 7 - CIERRE FINAL:
- El cambio se formaliza
- Recibirá WhatsApp con los pasos + email con contrato
- La factura se actualiza en 72 horas
- Despídete como José, su asesor asignado

REGLAS CRÍTICAS:
- Máximo 2-3 frases por respuesta
- NUNCA adelantes información del siguiente paso
- ESPERA la respuesta del cliente antes de continuar
- Si el cliente pregunta algo, responde y vuelve al flujo
- Si rechaza, pregunta si conoce a alguien interesado`;

  const messages = [
    { role: 'system', content: systemPrompt },
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
        exec(`edge-tts --text "${texto.replace(/"/g, '\\"')}" --voice es-ES-ElviraNeural | ffplay -autoexit -nodisp -i pipe:0`, () => resolve(null));
      } else {
        console.log(`✅ Audio generado: ${outputFile}`);
        resolve(outputFile);
      }
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

  // Mostrar datos del cliente si hay
  if (clienteActual) {
    mostrarCliente(clienteActual);
    // Usar solo el primer nombre
    const primerNombre = (clienteActual.nombre || 'usted').split(' ')[0];
    const saludo = `Hola, buenos días. ¿Hablo con ${primerNombre}? Le llamo del Departamento de Incidencias de Enerlux Soluciones por su suministro en ${clienteActual.direccion || clienteActual.dirección || 'su dirección'}.`;
    console.log(`🗣️ IA: "${saludo}"`);
    // Añadir saludo al historial para que la IA sepa que ya lo dijo
    historialConversacion.push({
      role: 'assistant',
      content: saludo
    });
    const audioSaludo = await textoAVozEdge(saludo);
    if (audioSaludo) console.log(`🔊 Audio guardado en: ${audioSaludo}`);
  } else {
    const saludo = "Hola, buenos días. Le llamo del Departamento de Incidencias de Enerlux Soluciones. ¿Podría hablar un momento sobre su suministro de luz?";
    console.log(`🗣️ IA: "${saludo}"`);
    // Añadir saludo al historial
    historialConversacion.push({
      role: 'assistant',
      content: saludo
    });
    const audioSaludo = await textoAVozEdge(saludo);
    if (audioSaludo) console.log(`🔊 Audio guardado en: ${audioSaludo}`);
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
      if (audio) console.log(`🔊 Audio guardado en: ${audio}`);

      preguntar();
    });
  };

  preguntar();
}

// ========================================
// MODO LLAMADAS DESDE CSV
// ========================================

async function modoCSV(csvPath) {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  if (!fs.existsSync(csvPath)) {
    console.log(`❌ ERROR: No existe el archivo ${csvPath}`);
    rl.close();
    return;
  }

  const clientes = parseCSV(csvPath);
  console.log(`📋 Cargados ${clientes.length} clientes del CSV\n`);

  if (clientes.length === 0) {
    console.log('❌ No se encontraron clientes en el CSV');
    rl.close();
    return;
  }

  // Mostrar lista de clientes
  console.log('📋 ═══════════════════════════════════');
  console.log('📋 CLIENTES DISPONIBLES:');
  console.log('📋 ═══════════════════════════════════');
  clientes.forEach((c, i) => {
    const nombre = c.nombre || 'Sin nombre';
    const tel = c.telefono || c.tel || 'Sin teléfono';
    console.log(`📋 ${String(i + 1).padStart(3)}. ${nombre.padEnd(35)} ${tel}`);
  });
  console.log('📋 ═══════════════════════════════════\n');

  // Preguntar qué cliente llamar
  rl.question('📞 Número de cliente a llamar (o "todos" para lista completa): ', async (respuesta) => {
    const idx = parseInt(respuesta) - 1;
    
    if (idx >= 0 && idx < clientes.length) {
      clienteActual = clientes[idx];
      console.log('\n📞 ═══════════════════════════════════');
      console.log('📞 CLIENTE SELECCIONADO:');
      console.log('📞 ═══════════════════════════════════');
      console.log(`📞 ID:           ${clienteActual.id}`);
      console.log(`📞 DNI:          ${clienteActual.dni || 'N/A'}`);
      console.log(`📞 Nombre:       ${clienteActual.nombre}`);
      console.log(`📞 Teléfono:     ${clienteActual.telefono}`);
      console.log(`📞 Email:        ${clienteActual.email || 'N/A'}`);
      console.log(`📞 Dirección:    ${clienteActual.direccion || 'N/A'}`);
      console.log(`📞 CP:           ${clienteActual.codigo_postal || 'N/A'}`);
      console.log('📞 ═══════════════════════════════════\n');
      rl.close();
      modoInteractivo();
    } else {
      console.log('❌ Selección inválida');
      rl.close();
    }
  });
}

// ========================================
// INICIAR
// ========================================

const args = process.argv.slice(2);
const csvIndex = args.findIndex(a => a === '--csv' || a === '-c');

if (csvIndex !== -1 && args[csvIndex + 1]) {
  const csvPath = args[csvIndex + 1];
  modoCSV(csvPath);
} else if (args.includes('--interactivo') || args.includes('-i')) {
  modoInteractivo();
} else if (args.includes('--llamar') || args.includes('-l')) {
  console.log('📞 Modo llamada con audio real');
  modoInteractivo();
} else if (args.includes('--help') || args.includes('-h')) {
  console.log('📝 USO:');
  console.log('');
  console.log('  node server-local.js --interactivo       → Prueba escribiendo (sin cliente)');
  console.log('  node server-local.js --csv clientes.csv  → Cargar clientes del CSV');
  console.log('  node server-local.js --llamar            → Con audio real (VB-CABLE)');
  console.log('');
  console.log('📋 FORMATO CSV:');
  console.log('  nombre,direccion,codigo_postal,telefono,email,iban,dni');
  console.log('  Juan García,Calle Mayor 1,28001,666123456,juan@email.com,ES12345678,12345678A');
  console.log('');
  console.log('🔑 CONFIGURACIÓN:');
  console.log('  Crear archivo .env con:');
  console.log('  GROQ_API_KEY=tu_api_key ( gratis en: https://console.groq.com )');
  console.log('');
} else {
  console.log('📝 USO:');
  console.log('  node server-local.js --interactivo       → Prueba escribiendo');
  console.log('  node server-local.js --csv clientes.csv  → Cargar clientes del CSV');
  console.log('  node server-local.js --help              → Ver ayuda completa');
  console.log('');
  modoInteractivo();
}