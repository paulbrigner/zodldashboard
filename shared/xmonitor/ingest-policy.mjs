const DISCOVERY_BASE_TERM_REGEX = /(?:\bzcash\b|\bzodl\b|\bzashi\b|(?<![a-z0-9_])(?:[$#]?zec)\b)/i;

export function normalizeHandle(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export function parseNormalizedHandleList(value) {
  if (!value) return [];

  const handles = String(value)
    .split(/[,\s]+/)
    .map((item) => normalizeHandle(item))
    .filter((item) => item.length > 0);

  return [...new Set(handles)];
}

export function buildOmitHandleSet(defaultHandles = [], overrideValue = "") {
  return new Set([
    ...defaultHandles.map((item) => normalizeHandle(item)).filter((item) => item.length > 0),
    ...parseNormalizedHandleList(overrideValue),
  ]);
}

export function isKeywordSourceQuery(sourceQuery) {
  const normalized = String(sourceQuery || "")
    .trim()
    .toLowerCase();
  return normalized === "discovery" || normalized === "keyword" || normalized === "both" || normalized === "legacy";
}

export function shouldOmitKeywordOriginPost(item, authorHandle, omitHandles) {
  if (!omitHandles.has(authorHandle)) return false;
  if (!isKeywordSourceQuery(item?.source_query)) return false;
  if (item?.watch_tier && String(item.watch_tier).trim().length > 0) return false;
  return true;
}

function normalizeSubstanceText(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[$#]([A-Za-z0-9_]+)/g, " $1 ")
    .replace(/@[A-Za-z0-9_][A-Za-z0-9_.]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDiscoveryBaseTerm(text) {
  const normalized = normalizeSubstanceText(text);
  if (!normalized) return false;
  return DISCOVERY_BASE_TERM_REGEX.test(normalized);
}

function escapeRegExpLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileBaseTermRegex(baseTerms) {
  const tokens = String(baseTerms || "")
    .split(/\s+OR\s+/i)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^\(+|\)+$/g, "").trim())
    .map((token) => token.replace(/^["']|["']$/g, "").trim())
    .map((token) => token.replace(/^[$#]+/, "").trim())
    .filter(Boolean);

  const patterns = [];
  for (const token of tokens) {
    const collapsed = token.replace(/\s+/g, " ").trim();
    if (!collapsed) continue;
    const escaped = collapsed
      .split(" ")
      .map((part) => escapeRegExpLiteral(part))
      .join("\\s+");
    if (/^[A-Za-z0-9_ ]+$/.test(collapsed)) {
      patterns.push(`\\b${escaped}\\b`);
    } else {
      patterns.push(escaped);
    }
  }

  if (patterns.length === 0) return DISCOVERY_BASE_TERM_REGEX;
  return new RegExp(`(?:${patterns.join("|")})`, "i");
}

export function hasConfiguredBaseTerm(text, baseTermRegex) {
  const normalized = normalizeSubstanceText(text);
  if (!normalized) return false;
  return (baseTermRegex || DISCOVERY_BASE_TERM_REGEX).test(normalized);
}

export function shouldOmitKeywordOriginMissingBaseTerm(item) {
  if (!isKeywordSourceQuery(item?.source_query)) return false;
  if (item?.watch_tier && String(item.watch_tier).trim().length > 0) return false;
  return !hasDiscoveryBaseTerm(item?.body_text);
}
