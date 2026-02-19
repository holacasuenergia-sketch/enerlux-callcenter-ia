/**
 * Health check endpoint
 */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  res.status(200).json({
    status: 'ok',
    service: 'Enerlux Call Center IA',
    timestamp: new Date().toISOString(),
    config: {
      twilio: !!process.env.TWILIO_ACCOUNT_SID,
      openai: !!process.env.OPENAI_API_KEY
    }
  });
}