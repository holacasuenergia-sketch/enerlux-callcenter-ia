/**
 * Iniciar llamada - POST /api/call
 */
import twilio from 'twilio';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  
  try {
    const { telefono, nombre } = req.body;
    
    if (!telefono) {
      return res.status(400).json({ error: 'Teléfono requerido' });
    }
    
    // Format phone number
    let phone = telefono.replace(/\D/g, '');
    if (!phone.startsWith('34') && phone.length === 9) {
      phone = '34' + phone;
    }
    
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : 'https://enerlux-callcenter-ia.vercel.app';
    
    const call = await client.calls.create({
      to: `+${phone}`,
      from: process.env.TWILIO_PHONE_NUMBER || '+34610243061',
      url: `${baseUrl}/api/voice`,
      statusCallback: `${baseUrl}/api/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
    });
    
    return res.status(200).json({
      success: true,
      sid: call.sid,
      status: call.status,
      mensaje: `Llamada iniciada a ${nombre || telefono}`
    });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: error.message,
      code: error.code
    });
  }
}