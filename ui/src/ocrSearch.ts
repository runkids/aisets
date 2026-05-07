const ocrTokenPattern = /[\p{L}\p{N}]+/gu;

export function matchesOCRSearchText(
  text: string,
  query: string,
  options: { fuzzy?: boolean } = {},
): boolean {
  const normalizedText = text.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery || !normalizedText) return false;
  if (normalizedText.includes(normalizedQuery)) return true;
  if (options.fuzzy === false) return false;
  if (normalizedQuery.length < 5) return false;

  const tokens = normalizedText.match(ocrTokenPattern) ?? [];
  return tokens.some((token) => {
    if (token.length < 4) return false;
    if (Math.abs(token.length - normalizedQuery.length) > 2) return false;
    if (
      normalizedQuery.startsWith(token) ||
      token.startsWith(normalizedQuery)
    ) {
      return true;
    }
    if (matchesOCRWindow(token, normalizedQuery)) {
      return true;
    }
    return boundedEditDistance(token, normalizedQuery, 2) <= 2;
  });
}

function matchesOCRWindow(token: string, query: string): boolean {
  if (token.length <= query.length) return false;
  for (const size of [query.length - 1, query.length, query.length + 1]) {
    if (size < 4 || size > token.length) continue;
    for (let start = 0; start <= token.length - size; start++) {
      const window = token.slice(start, start + size);
      if (boundedEditDistance(window, query, 2) <= 2) {
        return true;
      }
    }
  }
  return false;
}

function boundedEditDistance(
  a: string,
  b: string,
  maxDistance: number,
): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length] ?? maxDistance + 1;
}
