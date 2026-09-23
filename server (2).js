// ============================================================
// KAVYXI CHAINS — backend Stripe Checkout (Node.js + Express)
// ============================================================
// 1. npm init -y
// 2. npm install express stripe cors dotenv
// 3. Utwórz plik .env z zawartością:
//      STRIPE_SECRET_KEY=sk_test_...
//      STRIPE_PROMO_ICED_ID=promo_...      (ID kodu promocyjnego z Stripe Dashboard)
//      DOMAIN=http://localhost:4242        (adres, pod którym działa Twoja strona)
// 4. node server.js
//
// WAŻNE: cena, nazwa produktu i koszt dostawy są ZAWSZE liczone tutaj,
// na podstawie ID produktu przysłanego z koszyka — nigdy nie ufamy
// kwotom, które mogłyby przyjść z przeglądarki.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
app.use(cors());
app.use(express.json());

// --- Katalog produktów (ceny w groszach! 149 zł = 14900) ---
// Utrzymuj tę listę zsynchronizowaną z tablicą `products` w kodzie strony.
const PRODUCTS = {
  1: { name: 'Iced Cuban Chain',        price: 14900 },
  2: { name: 'Iced Cuban Bracelet',     price: 10900 },
  3: { name: 'Silver Chain',            price: 10900 },
  4: { name: 'Mini Iced Cross',         price: 8900 },
  5: { name: 'Classic Tennis Chain',    price: 13900 },
  6: { name: 'Classic Tennis Bracelet', price: 7900 },
};

// --- Wykończenia (dopłata w groszach, jeśli kiedyś dodasz różnicę cen) ---
const FINISHES = {
  silver: { label: 'Srebrna', priceAdd: 0 },
  gold:   { label: 'Złota',   priceAdd: 0 },
};

// --- Dostawa (te same progi co w koszyku na stronie) ---
const FREE_SHIPPING_THRESHOLD = 29900; // 299 zł, w groszach
const SHIPPING_FEE = 1000;             // 10 zł, w groszach

// Nazwa kuponu ICED utworzonego wcześniej w Stripe Dashboard
// (Products -> Coupons -> New: 20% off, kod promocyjny "ICED")
const PROMO_CODE_ID = process.env.STRIPE_PROMO_ICED_ID; // np. "promo_1Nxxxxxx"

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { items, promo } = req.body; // items: [{id, finish, qty}], promo: "ICED" | null

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Koszyk jest pusty.' });
    }

    let subtotal = 0;

    // Budujemy line_items WYŁĄCZNIE na podstawie własnej bazy cen i nazw —
    // id, finish i qty to jedyne dane, którym ufamy z przeglądarki.
    const line_items = items.map(({ id, finish, qty }) => {
      const product = PRODUCTS[id];
      if (!product) throw new Error(`Nieznany produkt: ${id}`);

      const finishKey = FINISHES[finish] ? finish : 'silver';
      const finishInfo = FINISHES[finishKey];
      const unitAmount = product.price + finishInfo.priceAdd;
      const quantity = Math.max(1, Number(qty) || 1);

      subtotal += unitAmount * quantity;

      return {
        price_data: {
          currency: 'pln',
          product_data: {
            name: `${product.name} — ${finishInfo.label}`,
          },
          unit_amount: unitAmount,
        },
        quantity,
      };
    });

    // Dostawa liczona po stronie serwera na podstawie sumy koszyka
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
      // Dopasuj do rzeczywistej struktury swojej strony:
      // jeśli masz index.html, produkt.html itd., trzymaj się tego samego wzorca.
      // sukces.html — statyczna strona potwierdzenia (przykład w pliku sukces.html)
      // index.html — strona główna z koszykiem (nie ma osobnej podstrony /koszyk)
      success_url: `${process.env.DOMAIN}/sukces.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN}/index.html`,
      shipping_address_collection: { allowed_countries: ['PL'] },
    };

    // Rabat ICED -20%, tylko jeśli klient podał poprawny kod i mamy jego ID promocji
    if (promo === 'ICED' && PROMO_CODE_ID) {
      sessionParams.discounts = [{ promotion_code: PROMO_CODE_ID }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Sprawdzenie statusu sesji dla strony sukces.html ---
app.get('/session-status', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
    res.json({
      status: session.payment_status, // 'paid', 'unpaid'...
      email: session.customer_details?.email || null,
      amount_total: session.amount_total, // w groszach
    });
  } catch (err) {
    res.status(400).json({ error: 'Nie znaleziono sesji.' });
  }
});

// --- Webhook: potwierdzenie zapłaty (opcjonalnie, ale zalecane) ---
// Ustaw endpoint w Stripe Dashboard -> Developers -> Webhooks
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // TODO: tu obsłuż zamówienie — zapis do bazy, wysyłka e-maila, magazyn itd.
    console.log('Opłacone zamówienie:', session.id);
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
