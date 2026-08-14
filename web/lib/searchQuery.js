const RESERVED_CHARS_RE = /[,()*%_]/g;

export function buildSearchWords(query) {
  return (query ?? '')
    .toString()
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(RESERVED_CHARS_RE, ''))
    .filter(Boolean);
}

export function buildSearchOrFilters(words, columns) {
  return words.map((word) => columns.map((col) => `${col}.ilike.*${word}*`).join(','));
}
