# 📞 Enerlux Call Center IA

Sistema de llamadas automatizadas con IA para captación de clientes.

## 🚀 Inicio Rápido

### 1. Instalar dependencias
```bash
cd enerlux-callcenter-ia
npm install
```

### 2. Configurar API Keys
Crea un archivo `.env` basándote en `.env.example`:

```env
# OpenAI - Obligatorio
OPENAI_API_KEY=sk-proj-tu-api-key

# ElevenLabs - Obligatorio para voz realista
ELEVENLABS_API_KEY=tu-api-key
ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB  # Voz masculina española

# Firebase - Ya configurado
FIREBASE_PROJECT_ID=enerlux-crm
FIREBASE_DATABASE_URL=https://enerlux-crm-default-rtdb.europe-west1.firebasedatabase.app
```

### 3. Configurar VB-CABLE
1. Asegúrate de que VB-CABLE está instalado
2. En Zadarma Softphone:
   - **Micrófono:** CABLE Output (VB-Audio Virtual Cable)
   - **Altavoz:** CABLE Input (VB-Audio Virtual Cable)

### 4. Iniciar el sistema
```bash
npm start
```

Abre http://localhost:3333 en tu navegador.

## 📋 Cargar Lista de Clientes

### Formato CSV:
```csv
nombre,telefono,direccion,notas
Juan García,612345678,Calle Mayor 1,Cliente potencial
María López,698765432,Avenida Sol 5,Ya tiene oferta
```

### Formato JSON:
```json
[
  {"nombre": "Juan García", "telefono": "612345678", "direccion": "Calle Mayor 1"},
  {"nombre": "María López", "telefono": "698765432", "direccion": "Avenida Sol 5"}
]
```

## 🎯 Flujo de Llamada

1. **Cargar clientes** → Arrastra el archivo CSV/JSON
2. **Seleccionar cliente** → Haz clic en la lista
3. **Llamar** → Haz clic en "📞 Llamar"
4. **Usar guiones** → Botones rápidos para respuestas predefinidas
5. **Interactuar** → Escribe lo que dice el cliente
6. **Finalizar** → Marca el resultado (interesado/no interesado)

## 🔧 Configuración de VB-CABLE

```
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   ZADARMA       │───────▶│  VB-CABLE       │───────▶│  CALL CENTER IA │
│   (llamada)     │        │  Output         │        │  (escucha)      │
└─────────────────┘        └─────────────────┘        └─────────────────┘
                                                              │
                                                              ▼
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   ZADARMA       │◀───────│  VB-CABLE       │◀───────│  ELEVENLABS     │
│   (escucha)     │        │  Input          │        │  (voz IA)       │
└─────────────────┘        └─────────────────┘        └─────────────────┘
```

## 💰 Costos Estimados

| Servicio | Costo |
|----------|-------|
| **OpenAI GPT-4** | ~€0.01-0.03/min |
| **OpenAI Whisper** | ~€0.006/min |
| **ElevenLabs TTS** | ~€22/mes ( Starter) |
| **Total llamadas** | ~€0.02-0.05/min |

**Ejemplo:** 100 llamadas × 3 min = 300 min = **~€6-15** en APIs

## 🎤 Voces ElevenLabs Recomendadas

| ID | Nombre | Estilo |
|----|--------|--------|
| `pNInz6obpgDQGcFmaJgB` | Adam | Masculina, natural |
| `ErXwobaYiN019PkySvjV` | Antoni | Masculina, profesional |
| `EXAVITQu4vr4xnSDxMaL` | Sarah | Femenina, amable |
| `MF3mGyEYCl7XYWbV9V6O` | Eve | Femenina, joven |

Para cambiar la voz, edita `ELEVENLABS_VOICE_ID` en `.env`.

## 📁 Estructura del Proyecto

```
enerlux-callcenter-ia/
├── server.js           # Servidor Express + WebSocket
├── call-agent.js       # Lógica del agente IA
├── package.json        # Dependencias
├── .env.example        # Variables de entorno
├── public/
│   └── index.html      # Panel de control web
└── README.md           # Este archivo
```

## ⚠️ Requisitos

- **Node.js** 18+
- **Windows** (para VB-CABLE)
- **Zadarma** u otro softphone
- **Cuentas API:**
  - OpenAI (GPT-4 + Whisper)
  - ElevenLabs (TTS)

## 🔐 Seguridad

- **NUNCA** subas el archivo `.env` a Git
- Regenera las API keys si se exponen
- Firebase ya está configurado con reglas seguras