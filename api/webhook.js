// ============================================================
// POST /api/webhook
// TO jest źródło prawdy o opłaceniu zamówienia — nie session-status,
// nie success_url. Stripe podpisuje to żądanie swoim sekretem,
// więc nikt z zewnątrz nie może go podrobić.
//
// Konfiguracja w Stripe Dashboard -> Developers -> Webhooks:
//   Endpoint URL: https://twoja-domena.vercel.app/api/webhook
//   Zdarzenie:    checkout.session.completed
// Skopiuj "Signing secret" (whsec_...) do zmiennej środowiskowej
// STRIPE_WEBHOOK_SECRET w ustawieniach projektu na Vercel.
// ============================================================

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// service_role key — ma pełny dostęp z pominięciem RLS. Używaj GO WYŁĄCZNIE
// tutaj, na backendzie. Nigdy nie wysyłaj go do przeglądarki.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// KLUCZOWE dla Vercel: wyłączamy domyślny bodyParser, bo Stripe
// wymaga SUROWEGO body do weryfikacji podpisu (JSON.stringify
// zniekształciłby bajty i podpis by się nie zgadzał).
module.exports.config = {
  api: { bodyParser: false },
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Nieprawidłowy podpis webhooka:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Dopiero ten zapis (wywołany przez podpisany webhook Stripe,
    // nie przez przeglądarkę) powinien decydować, czy zamówienie
    // trafia do realizacji/wysyłki.
    const { error } = await supabase.from('orders').upsert(
      {
        stripe_session_id: session.id,
        status: 'paid',
        email: session.customer_details?.email || null,
        amount_total: session.amount_total,
        promo: session.metadata?.promo || null,
        paid_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_session_id' }
    );

    if (error) {
      console.error('Błąd zapisu do Supabase:', error);
      // Zwracamy 500, żeby Stripe spróbował dostarczyć webhook ponownie
      return res.status(500).json({ error: 'Błąd zapisu zamówienia.' });
    }

    console.log('✅ Zamówienie zapisane jako opłacone:', session.id);
  }

  res.status(200).json({ received: true });
};
