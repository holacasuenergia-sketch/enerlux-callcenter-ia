/**
 * Call status callback - POST /api/status
 */
export default async function handler(req, res) {
  // Log call status
  console.log('Call status update:', {
    sid: req.body.CallSid,
    status: req.body.CallStatus,
    duration: req.body.CallDuration,
    from: req.body.From,
    to: req.body.To
  });
  
  res.status(200).end();
}