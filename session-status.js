// ============================================================
// GET /api/session-status?session_id=...
// Używane WYŁĄCZNIE do wyświetlenia klientowi komunikatu na
// stronie sukces.html. To NIE jest źródło prawdy o zamówieniu —
// do tego służy webhook (checkout.session.completed), bo tylko
// on jest podpisany przez Stripe i nie da się go podrobić z przeglądarki.
// ============================================================

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sessionId = req.query.session_id;

  try {
    // Najpierw sprawdzamy Supabase — jeśli webhook już zapisał zamówienie
    // jako opłacone, to jest pewniejsze źródło niż odpytywanie Stripe
    // od razu po przekierowaniu (webhook mógł dotrzeć wcześniej lub później).
    const { data: order } = await supabase
      .from('orders')
      .select('status, email, amount_total')
      .eq('stripe_session_id', sessionId)
      .maybeSingle();

    if (order?.status === 'paid') {
      return res.status(200).json({
        status: 'paid',
        email: order.email,
        amount_total: order.amount_total,
      });
    }

    // Webhook mógł jeszcze nie dotrzeć — pytamy Stripe bezpośrednio jako fallback.
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.status(200).json({
      status: session.payment_status, // 'paid' | 'unpaid' | 'no_payment_required'
      email: session.customer_details?.email || null,
      amount_total: session.amount_total,
    });
  } catch (err) {
    res.status(400).json({ error: 'Nie znaleziono sesji.' });
  }
};
