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

function parseCSV(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  
  // Detectar formato del CSV
  const firstLine = lines[0].split(',').map(v => v.trim());
  
  // Si la primera línea tiene encabezados conocidos
  const tieneHeaders = firstLine.some(h => 
    h.toLowerCase().includes('nombre') || 
    h.toLowerCase().includes('telefono') ||
    h.toLowerCase().includes('dni')
  );
  
  let startLine = 0;
  
  // Si tiene encabezados, saltar la primera línea
  if (tieneHeaders) {
    startLine = 1;
  }
  
  // Si la primera línea es un número (contador), saltarla
  if (!isNaN(firstLine[0]) && firstLine.length === 1) {
    startLine = 1;
  }
  
  const clientes = [];
  
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(',').map(v => v.trim());
    
    // Formato Enerlux: ID, DNI, NOMBRE, TELEFONO, EMAIL, DIRECCION, CODIGO_POSTAL
    // (sin IBAN)
    if (values.length >= 5) {
      const cliente = {
        id: values[0] || '',
        dni: values[1] || '',
        nombre: values[2] || '',
        telefono: values[3] || '',
        email: values[4] || '',
        direccion: values[5] || '',
        codigo_postal: values[6] || ''
      };
      
      // Ignorar líneas que son solo encabezados
      if (cliente.nombre.toLowerCase().includes('nombre')) continue;
      
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
  
  const datos = [];
  if (cliente.nombre) datos.push(`NOMBRE: ${cliente.nombre}`);
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

  const systemPrompt = `Eres un agente telefónico de Enerlux Soluciones, una ASESORÍA ENERGÉTICA en España.

IMPORTANTE: Enerlux NO es una comercializadora. Es una asesoria que evalúa las distintas compañías (Endesa, Naturgy, Iberdrola, Gana Energía, etc.) y encuentra el mejor precio para el cliente según su zona.

TU NOMBRE: José (usalo para presentarte)
${generarPromptCliente(clienteActual)}

SPEECH OFICIAL (síguelo pero de forma natural):

1. SALUDO INICIAL:
"Hola, buenos días/tardes, ¿hablo con [Nombre]? Encantado, mi nombre es José. Le llamo del Departamento de Incidencias por su punto de suministro de luz en [Dirección]. ¿Es usted el titular?"

2. GANCHO - SOBRECOSTE:
"Le llamamos porque hemos detectado que su suministro está arrastrando un 36% de sobrecoste heredado de la facturación del año pasado. ¿Cuánto le ha estado llegando en su factura?"

3. PREGUNTAR COMPAÑÍA ACTUAL:
"¿Actualmente con qué compañía se encuentra?"

4. OFERTA POR ZONA:
"Correcto, por código postal [CÓDIGO POSTAL] de su zona, hemos evaluado las compañías disponibles (Endesa, Naturgy, Iberdrola, Gana Energía) y le brindamos el mejor precio: 0,10€/kWh. Vamos a corregir esta incidencia y bajarle el precio de los 0,15€ que tiene ahora. Así deja de pagar ese 36% de más."

5. CONFIRMACIÓN DE DATOS:
"Es un minuto para dejarlo listo. No le pediré datos ya que nos corresponde saberlo por la compañía."
Confirmar: Nombre completo, correo, teléfono, dirección, IBAN (últimos 4 dígitos), DNI (últimos 2 dígitos).
Preguntar: "¿Desea su facturación en papel o por email?"

6. CIERRE:
"De acuerdo. Ahora tenga su DNI o NIE a mano porque vamos a formalizarlo. Le va a llegar un WhatsApp con los pasos y el contrato al email con la actualización al precio de 0,10€. Queda activa desde hoy y ya le deja de venir ese recargo."

7. DESPEDIDA:
"Muchas gracias por confiar en Enerlux Soluciones. Desde hoy soy José, tu asesor asignado. Enhorabuena: ya estás pagando lo correcto y aprovechando tu descuento."

REGLAS:
- Responde BREVE (máximo 2-3 frases)
- Enerlux es ASESORÍA, no comercializadora - evaluamos compañías para encontrar el mejor precio
- Si el cliente pregunta por datos personales, confirma los que ya tienes
- Si el cliente está interesado, pasa a confirmar datos
- Si el cliente rechaza, pregunta si conoce a alguien interesado
- Siempre en español, natural y conversacional`;

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
    const saludo = `Hola, buenos días. ¿Hablo con ${clienteActual.nombre || 'usted'}? Le llamo del Departamento de Incidencias de Enerlux Soluciones por su suministro en ${clienteActual.direccion || clienteActual.dirección || 'su dirección'}.`;
    console.log(`🗣️ IA: "${saludo}"`);
    const audioSaludo = await textoAVozEdge(saludo);
    if (audioSaludo) console.log(`🔊 Audio guardado en: ${audioSaludo}`);
  } else {
    const saludo = "Hola, buenos días. Le llamo del Departamento de Incidencias de Enerlux Soluciones. ¿Podría hablar un momento sobre su suministro de luz?";
    console.log(`🗣️ IA: "${saludo}"`);
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
  if (!fs.existsSync(csvPath)) {
    console.log(`❌ ERROR: No existe el archivo ${csvPath}`);
    return;
  }

  const clientes = parseCSV(csvPath);
  console.log(`📋 Cargados ${clientes.length} clientes del CSV\n`);

  if (clientes.length === 0) {
    console.log('❌ No se encontraron clientes en el CSV');
    return;
  }

  console.log('📋 Lista de clientes:');
  clientes.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.nombre || 'Sin nombre'} - ${c.telefono || c.tel || 'Sin teléfono'}`);
  });
  console.log('');

  modoInteractivo();
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