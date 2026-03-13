function normalizeTerm(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function parseTextFilterQuery(value) {
  const text = normalizeTerm(value);
  if (!text) {
    return {
      includeTerms: [],
      excludeTerms: [],
    };
  }

  const includeTerms = [];
  const excludeTerms = [];
  const includeSeen = new Set();
  const excludeSeen = new Set();
  const pattern = /(-?)"([^"]+)"|(-)?([^\s"]+)/g;

  for (const match of text.matchAll(pattern)) {
    const negative = match[1] === "-" || match[3] === "-";
    const term = normalizeTerm(match[2] ?? match[4] ?? "");
    if (!term) continue;

    const normalized = term.toLowerCase();
    if (negative) {
      if (excludeSeen.has(normalized)) continue;
      excludeSeen.add(normalized);
      excludeTerms.push(term);
      continue;
    }

    if (includeSeen.has(normalized)) continue;
    includeSeen.add(normalized);
    includeTerms.push(term);
  }

  return {
    includeTerms,
    excludeTerms,
  };
}
