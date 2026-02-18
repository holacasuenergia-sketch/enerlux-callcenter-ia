/**
 * ENERLUX CALL CENTER IA - SERVIDOR PRINCIPAL
 * Interfaz web para controlar las llamadas
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const { spawn } = require('child_process');

const callAgent = require('./call-agent');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado del sistema
let sistemaEstado = {
  activo: false,
  llamando: false,
  conversacion: null,
  clientes: [],
  clienteActual: null
};

// ========================================
// API REST
// ========================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activo: sistemaEstado.activo,
    llamando: sistemaEstado.llamando
  });
});

// Obtener estado del sistema
app.get('/api/estado', (req, res) => {
  res.json(sistemaEstado);
});

// Cargar lista de clientes
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
  
  res.json({
    message: `${clientes.length} clientes cargados`,
    clientes: sistemaEstado.clientes
  });
});

// Iniciar llamada a cliente específico
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
    
    // Iniciar conversación con datos del cliente
    callAgent.iniciarConversacion({
      nombre: cliente.nombre,
      telefono: cliente.telefono
    });
    
    // Notificar a todos los clientes WebSocket
    broadcast({ type: 'llamada_iniciada', cliente });
    
    res.json({
      message: 'Llamada iniciada',
      cliente
    });
    
  } catch (error) {
    sistemaEstado.llamando = false;
    res.status(500).json({ error: error.message });
  }
});

// Finalizar llamada
app.post('/api/finalizar', async (req, res) => {
  const { resultado, datos } = req.body;
  
  try {
    const lead = await callAgent.finalizarConversacion(resultado);
    
    // Actualizar estado del cliente
    if (sistemaEstado.clienteActual) {
      const index = sistemaEstado.clientes.findIndex(
        c => c.telefono === sistemaEstado.clienteActual.telefono
      );
      if (index >= 0) {
        sistemaEstado.clientes[index].estado = resultado;
        sistemaEstado.clientes[index].intentos++;
      }
    }
    
    sistemaEstado.llamando = false;
    sistemaEstado.clienteActual = null;
    
    broadcast({ type: 'llamada_finalizada', lead, resultado });
    
    res.json({ message: 'Llamada finalizada', lead });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Procesar respuesta del cliente (para testing)
app.post('/api/responder', async (req, res) => {
  const { texto } = req.body;
  
  if (!sistemaEstado.llamando) {
    return res.status(400).json({ error: 'No hay llamada activa' });
  }
  
  try {
    const respuesta = await callAgent.generarRespuesta(texto);
    const audio = await callAgent.textToSpeech(respuesta);
    
    broadcast({ type: 'respuesta', texto: respuesta });
    
    res.json({ respuesta });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ejecutar guion predefinido
app.post('/api/guion/:nombre', async (req, res) => {
  const { nombre } = req.params;
  const { params } = req.body;
  
  const guion = callAgent.GUIONES[nombre];
  if (!guion) {
    return res.status(404).json({ error: 'Guion no encontrado' });
  }
  
  try {
    const texto = await guion(params);
    broadcast({ type: 'guion', nombre, texto });
    res.json({ texto });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Siguiente cliente en la lista
app.get('/api/siguiente', (req, res) => {
  const pendientes = sistemaEstado.clientes.filter(c => c.estado === 'pendiente');
  
  if (pendientes.length === 0) {
    return res.json({ message: 'No hay más clientes pendientes' });
  }
  
  const siguiente = pendientes[0];
  const index = sistemaEstado.clientes.indexOf(siguiente);
  
  res.json({
    index,
    cliente: siguiente,
    pendientes: pendientes.length
  });
});

// ========================================
// WEBSOCKET - Comunicación en tiempo real
// ========================================

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('📱 Cliente conectado'];
  
  // Enviar estado actual
  ws.send(JSON.stringify({
    type: 'estado',
    data: sistemaEstado
  }));
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'audio':
          // Procesar audio del cliente
          const respuesta = await callAgent.procesarAudioCliente(data.audio);
          ws.send(JSON.stringify({ type: 'respuesta', texto: respuesta }));
          break;
          
        case 'estado':
          ws.send(JSON.stringify({
            type: 'estado',
            data: sistemaEstado
          }));
          break;
      }
    } catch (error) {
      console.error('Error WebSocket:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('📱 Cliente desconectado');
  });
});

// ========================================
// INICIAR SERVIDOR
// ========================================

const PORT = process.env.PORT || 3333;

server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   📞 ENERLUX CALL CENTER IA            ║');
  console.log('║   Sistema de llamadas inteligente      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(`🌐 Panel de control: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log('');
  console.log('Modo de uso:');
  console.log('1. Abre http://localhost:3333 en tu navegador');
  console.log('2. Carga la lista de clientes (CSV o JSON)');
  console.log('3. Haz clic en "Llamar" para iniciar una llamada');
  console.log('4. Usa Zadarma con VB-CABLE conectado');
  console.log('');
  console.log('⚠️  Asegúrate de tener:');
  console.log('   - OPENAI_API_KEY en .env');
  console.log('   - ELEVENLABS_API_KEY en .env');
  console.log('');
});

module.exports = { app, server, broadcast };