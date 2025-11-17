const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(500).json({ error: 'Stripe secret key not configured' });
    return;
  }

  try {
    const priceInCents = process.env.PRICE_CENTS ? Number(process.env.PRICE_CENTS) : 499;
    const currency = process.env.CURRENCY || 'usd';

    const origin = getOrigin(req);
    const successBase = process.env.SUCCESS_URL || `${origin}/?session_id={CHECKOUT_SESSION_ID}&payment=success`;
    const cancelUrl = process.env.CANCEL_URL || `${origin}/`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: 'Fantasy College Basketball — Pro Unlock',
              description: 'Unlock pro features (no account required)',
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      success_url: successBase,
      cancel_url: cancelUrl,
      metadata: {
        product: 'fcb_pro_unlock',
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error', err);
    res.status(500).json({ error: 'Internal error creating checkout session' });
  }
};

function getOrigin(req){
  if (req.headers && req.headers.origin) return req.headers.origin;
  if (req.headers && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return `${proto}://${req.headers.host}`;
  }
  return 'http://localhost:3000';
}
