const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  let rawBody = req.rawBody;
  if (!rawBody) {
    try {
      rawBody = await new Promise((resolve, reject) => {
        let data = [];
        req.on('data', chunk => data.push(chunk));
        req.on('end', () => resolve(Buffer.concat(data)));
        req.on('error', err => reject(err));
      });
    } catch (err) {
      console.error('Failed to read raw body', err);
      res.status(400).send('Failed to read raw body');
      return;
    }
  }

  const signature = req.headers['stripe-signature'];

  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } else {
      event = req.body;
    }
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log('Checkout session completed:', session.id, 'payment_status:', session.payment_status);
      break;
    default:
      console.log('Unhandled event type:', event.type);
  }

  res.status(200).send('ok');
};
