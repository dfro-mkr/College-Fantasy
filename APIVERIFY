const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  try {
    const sessionId = (req.method === 'GET') ? req.query.session_id : (req.body && req.body.session_id);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing session_id' });
      return;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });

    const paid = session.payment_status === 'paid' || (session.payment_intent && session.payment_intent.status === 'succeeded');

    res.status(200).json({ paid: !!paid, session });
  } catch (err) {
    console.error('verify-session error', err);
    res.status(500).json({ error: 'Failed to verify session' });
  }
};
