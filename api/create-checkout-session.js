// ============================================================
// POST /api/create-checkout-session
// Tworzy sesję Stripe Checkout na podstawie koszyka.
// Cena, nazwa i dostawa liczone TYLKO tutaj — nigdy z danych
// przysłanych przez przeglądarkę.
// ============================================================

const Stripe = require('stripe');
const { PRODUCTS, FINISHES, FREE_SHIPPING_THRESHOLD, SHIPPING_FEE, lookupKey } = require('./_catalog');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS — dopasuj origin do domeny swojego sklepu w produkcji
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { items, promo } = req.body; // items: [{id, finish, qty}], promo: "ICED" | null

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Koszyk jest pusty.' });
    }

    // Wszystkie potrzebne lookup_key zbieramy z góry i pobieramy w JEDNYM
    // zapytaniu do Stripe (do 10 na raz), zamiast odpytywać osobno w pętli.
    const normalizedItems = items.map(({ id, finish, qty }) => {
      const product = PRODUCTS[id];
      if (!product) throw new Error(`Nieznany produkt: ${id}`);
      const finishKey = FINISHES[finish] ? finish : 'silver';
      return {
        id,
        finishKey,
        quantity: Math.max(1, Number(qty) || 1),
        lookupKey: lookupKey(id, finishKey),
      };
    });

    const uniqueLookupKeys = [...new Set(normalizedItems.map(i => i.lookupKey))];
    const priceList = await stripe.prices.list({
      lookup_keys: uniqueLookupKeys,
      limit: uniqueLookupKeys.length,
    });

    const priceByLookupKey = {};
    for (const price of priceList.data) {
      priceByLookupKey[price.lookup_key] = price;
    }

    let subtotal = 0;

    const line_items = normalizedItems.map(({ id, lookupKey: lk, quantity }) => {
      const price = priceByLookupKey[lk];
      if (!price) throw new Error(`Nie znaleziono ceny w Stripe dla: ${lk}`);

      subtotal += price.unit_amount * quantity;

      // Używamy prawdziwego price.id ze Stripe — nie price_data —
      // dzięki temu sprzedaż jest poprawnie przypisana do konkretnego
      // produktu i wykończenia w raportach Stripe.
      return { price: price.id, quantity };
    });

    const shippingCost = subtotal > 0 && subtotal < FREE_SHIPPING_THRESHOLD ? SHIPPING_FEE : 0;
    if (shippingCost > 0) {
      line_items.push({
        price_data: {
          currency: 'pln',
          product_data: { name: 'Dostawa' },
          unit_amount: shippingCost,
        },
        quantity: 1,
      });
    }

    const sessionParams = {
      mode: 'payment',
      line_items,
      // process.env.DOMAIN np. "https://kavyxichains.vercel.app"
      success_url: `${process.env.DOMAIN}/sukces.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN}/index.html`,
      shipping_address_collection: { allowed_countries: ['PL'] },
      // przydatne do dopasowania webhooka do zamówienia w Twojej bazie:
      metadata: { promo: promo === 'ICED' ? 'ICED' : '' },
    };

    if (promo === 'ICED' && process.env.STRIPE_PROMO_ICED_ID) {
      sessionParams.discounts = [{ promotion_code: process.env.STRIPE_PROMO_ICED_ID }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
