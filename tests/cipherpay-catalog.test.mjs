import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCipherPayCatalogProducts,
  parseCipherPaySessionCookie,
} from "../shared/cipherpay-test/catalog.mjs";

test("parseCipherPaySessionCookie extracts the cookie pair from a Set-Cookie header", () => {
  const cookie = parseCipherPaySessionCookie("__Host-cpay_session=session_123; Path=/; HttpOnly; Secure; SameSite=Lax");
  assert.equal(cookie, "__Host-cpay_session=session_123");
});

test("normalizeCipherPayCatalogProducts keeps active products with active prices only", () => {
  const products = normalizeCipherPayCatalogProducts([
    {
      id: "prod_1",
      slug: "privacy-tee",
      name: "Privacy Tee",
      description: "Soft cotton tee",
      default_price_id: "price_usd",
      metadata: { category: "apparel" },
      active: 1,
      created_at: "2026-03-14T18:00:00Z",
      prices: [
        {
          id: "price_usd",
          product_id: "prod_1",
          currency: "usd",
          unit_amount: 29.99,
          price_type: "one_time",
          billing_interval: null,
          interval_count: null,
          active: 1,
          created_at: "2026-03-14T18:01:00Z",
        },
        {
          id: "price_old",
          product_id: "prod_1",
          currency: "eur",
          unit_amount: 24.99,
          price_type: "one_time",
          billing_interval: null,
          interval_count: null,
          active: 0,
          created_at: "2026-03-14T18:01:00Z",
        },
      ],
    },
    {
      id: "prod_2",
      slug: "archived-item",
      name: "Archived Item",
      active: 0,
      prices: [
        {
          id: "price_archived",
          product_id: "prod_2",
          currency: "USD",
          unit_amount: 1,
          active: 1,
        },
      ],
    },
  ]);

  assert.equal(products.length, 1);
  assert.equal(products[0].id, "prod_1");
  assert.equal(products[0].default_price_id, "price_usd");
  assert.deepEqual(products[0].metadata, { category: "apparel" });
  assert.equal(products[0].prices.length, 1);
  assert.equal(products[0].prices[0].currency, "USD");
});
