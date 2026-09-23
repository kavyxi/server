// ============================================================
// Wspólne dane: katalog produktów, wykończeń i progów dostawy.
// Import w każdej funkcji API, żeby wszystko było w jednym miejscu.
//
// Ceny NIE są tu już liczone ręcznie — każdy produkt ma w Stripie
// dwie prawdziwe ceny (Price), po jednej na wykończenie, otagowane
// lookup_key: "kavyxi-{id}-silver" / "kavyxi-{id}-gold".
// Backend pobiera je z API Stripe po lookup_key (patrz getPriceId
// w create-checkout-session.js) — dzięki temu w Stripe Dashboard
// od razu widać sprzedaż osobno dla srebrnej i złotej wersji.
// ============================================================

const PRODUCTS = {
  1: { name: 'Iced Cuban Chain',        stripeProductId: 'prod_VJaMwUppWEyyBM' },
  2: { name: 'Iced Cuban Bracelet',     stripeProductId: 'prod_VJaMAHksdqUEBz' },
  3: { name: 'Silver Chain',            stripeProductId: 'prod_VJaMCmOP1I6aJB' },
  4: { name: 'Mini Iced Cross',         stripeProductId: 'prod_VJaMkbHCJUfQSK' },
  5: { name: 'Classic Tennis Chain',    stripeProductId: 'prod_VJaMS4xkv1wy5r' },
  6: { name: 'Classic Tennis Bracelet', stripeProductId: 'prod_VJaM8fhF99DzTt' },
};

const FINISHES = {
  silver: { label: 'Srebrna' },
  gold:   { label: 'Złota' },
};

function lookupKey(productId, finish) {
  return `kavyxi-${productId}-${finish}`;
}

const FREE_SHIPPING_THRESHOLD = 29900; // 299 zł
const SHIPPING_FEE = 1000;             // 10 zł

module.exports = { PRODUCTS, FINISHES, FREE_SHIPPING_THRESHOLD, SHIPPING_FEE, lookupKey };
