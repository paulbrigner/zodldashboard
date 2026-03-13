const BOUNDARY_KEYWORDS = new Set(["zec", "btc"]);

export const SUMMARY_THEME_KEYWORDS = {
  "Governance / strategy": [
    "governance",
    "consensus",
    "nu7",
    "nu6",
    "roadmap",
    "poll",
    "polling",
    "zsa",
    "shielded asset",
    "fee burning",
    "arborist",
    "zcashd",
    "grants",
  ],
  "Privacy / freedom narrative": [
    "privacy",
    "private",
    "surveillance",
    "freedom",
    "censorship",
    "encrypted",
    "shielded",
    "civil liberties",
  ],
  "Market / price": [
    "zec",
    "price",
    "btc",
    "bitcoin",
    "ath",
    "stack",
    "buy",
    "market cap",
    "bull",
    "bear",
  ],
  "Product / ecosystem": [
    "wallet",
    "zashi",
    "integration",
    "release",
    "upgrade",
    "partnership",
    "sdk",
    "api",
    "zodl",
    "foundation",
    "commgrants",
    "shieldedlabs",
  ],
  "Community / memes": [
    "gm",
    "meme",
    "lol",
    "lfg",
    "vibes",
    "blessed",
    "replying to",
  ],
};

export const SUMMARY_DEBATE_ISSUES = {
  "ZSA direction": {
    keywords: ["zsa", "shielded asset", "shielded assets", "fee burning", "private stables"],
    pro: ["support", "worth", "needed", "should", "important", "bullish", "yes"],
    contra: ["against", "distract", "risk", "oppose", "bad", "concern", "no"],
  },
  "Governance legitimacy": {
    keywords: ["governance", "poll", "polling", "consensus", "nu7", "vote", "voting"],
    pro: ["clear", "majority", "consensus", "agree", "valid"],
    contra: ["unclear", "contested", "disagree", "not representative", "invalid"],
  },
  "Execution readiness": {
    keywords: ["arborist", "zcashd", "migration", "upgrade", "audit", "timeline"],
    pro: ["ready", "on track", "solid", "progress"],
    contra: ["blocked", "delay", "not ready", "behind", "risk"],
  },
};

export const SUMMARY_THEME_LABELS = Object.freeze(Object.keys(SUMMARY_THEME_KEYWORDS));
export const SUMMARY_DEBATE_LABELS = Object.freeze(Object.keys(SUMMARY_DEBATE_ISSUES));

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLabelFilters(input, labels) {
  const rawValues = Array.isArray(input) ? input : input === undefined ? [] : [input];
  if (rawValues.length === 0) return [];

  const labelMap = new Map(labels.map((label) => [label.toLowerCase(), label]));
  const selected = [];
  const seen = new Set();
  for (const item of rawValues) {
    const chunks = String(item || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const chunk of chunks) {
      const canonical = labelMap.get(chunk.toLowerCase());
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      selected.push(canonical);
    }
  }

  return selected;
}

function buildKeywordMatcher(keyword) {
  const normalized = String(keyword || "").trim().toLowerCase();
  if (!normalized) return null;
  if (BOUNDARY_KEYWORDS.has(normalized)) {
    return {
      type: "regex",
      value: `(^|[^a-z0-9_])${escapeRegex(normalized)}($|[^a-z0-9_])`,
    };
  }
  return {
    type: "contains",
    value: normalized,
  };
}

function includesKeyword(normalizedText, keyword) {
  const matcher = buildKeywordMatcher(keyword);
  if (!matcher || !normalizedText) return false;
  if (matcher.type === "regex") {
    return new RegExp(matcher.value).test(normalizedText);
  }
  return normalizedText.includes(matcher.value);
}

export function normalizeSummaryTaxonomyText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[$#]([A-Za-z0-9_]+)/g, " $1 ")
    .replace(/@[A-Za-z0-9_][A-Za-z0-9_.]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function detectSummaryThemes(text) {
  const normalized = normalizeSummaryTaxonomyText(text);
  if (!normalized) return [];

  const hits = [];
  for (const [theme, keywords] of Object.entries(SUMMARY_THEME_KEYWORDS)) {
    if (keywords.some((keyword) => includesKeyword(normalized, keyword))) {
      hits.push(theme);
    }
  }
  return hits;
}

export function detectSummaryDebateMatches(text) {
  const normalized = normalizeSummaryTaxonomyText(text);
  if (!normalized) return [];

  const matches = [];
  for (const [issue, config] of Object.entries(SUMMARY_DEBATE_ISSUES)) {
    const hasKeyword = config.keywords.some((keyword) => includesKeyword(normalized, keyword));
    if (!hasKeyword) continue;

    const hasPro = config.pro.some((keyword) => includesKeyword(normalized, keyword));
    const hasContra = config.contra.some((keyword) => includesKeyword(normalized, keyword));

    let stance = "neutral";
    if (hasPro && hasContra) stance = "mixed";
    else if (hasPro) stance = "pro";
    else if (hasContra) stance = "contra";

    matches.push([issue, stance]);
  }

  return matches;
}

export function normalizeSummaryThemeFilters(input) {
  return normalizeLabelFilters(input, SUMMARY_THEME_LABELS);
}

export function normalizeSummaryDebateFilters(input) {
  return normalizeLabelFilters(input, SUMMARY_DEBATE_LABELS);
}

export function buildSummaryThemeMatcherGroups(labels) {
  return normalizeSummaryThemeFilters(labels).map((label) => ({
    label,
    matchers: SUMMARY_THEME_KEYWORDS[label]
      .map(buildKeywordMatcher)
      .filter(Boolean),
  }));
}

export function buildSummaryDebateMatcherGroups(labels) {
  return normalizeSummaryDebateFilters(labels).map((label) => ({
    label,
    matchers: SUMMARY_DEBATE_ISSUES[label].keywords
      .map(buildKeywordMatcher)
      .filter(Boolean),
  }));
}
