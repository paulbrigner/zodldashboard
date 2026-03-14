function asString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

function asIsoTimestamp(value) {
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeCatalogPrice(value) {
  const item = asRecord(value);
  if (!item) return null;

  const id = asString(item.id);
  const productId = asString(item.product_id);
  const currency = asString(item.currency)?.toUpperCase();
  const unitAmount = asFiniteNumber(item.unit_amount);
  if (!id || !productId || !currency || unitAmount == null) {
    return null;
  }

  return {
    id,
    product_id: productId,
    currency,
    unit_amount: unitAmount,
    price_type: asString(item.price_type) || "one_time",
    billing_interval: asString(item.billing_interval),
    interval_count: Number.isInteger(item.interval_count) ? item.interval_count : null,
    active: asBoolean(item.active, true),
    created_at: asIsoTimestamp(item.created_at),
  };
}

function normalizeCatalogProduct(value) {
  const item = asRecord(value);
  if (!item) return null;

  const id = asString(item.id);
  const name = asString(item.name);
  const slug = asString(item.slug);
  if (!id || !name || !slug) {
    return null;
  }

  const prices = Array.isArray(item.prices)
    ? item.prices.map(normalizeCatalogPrice).filter((price) => price && price.active)
    : [];
  const active = asBoolean(item.active, true);
  if (!active) {
    return null;
  }

  const metadata = asRecord(item.metadata);
  const defaultPriceId = asString(item.default_price_id);

  return {
    id,
    slug,
    name,
    description: asString(item.description),
    default_price_id: defaultPriceId && prices.some((price) => price.id === defaultPriceId) ? defaultPriceId : null,
    metadata,
    active: true,
    created_at: asIsoTimestamp(item.created_at),
    prices,
  };
}

export function normalizeCipherPayCatalogProducts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeCatalogProduct)
    .filter((product) => product && product.prices.length > 0);
}

export function parseCipherPaySessionCookie(setCookieValue) {
  const text = asString(setCookieValue);
  if (!text) return null;
  const firstSegment = text.split(";")[0]?.trim() || "";
  const separatorIndex = firstSegment.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === firstSegment.length - 1) {
    return null;
  }
  return firstSegment;
}
