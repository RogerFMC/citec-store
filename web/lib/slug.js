const UUID_SUFFIX_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function slugify(text) {
  return (text ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function buildProductSlug(model, id) {
  const base = slugify(model) || 'producto';
  return `${base}-${id}`;
}

export function extractProductId(slugParam) {
  const match = (slugParam ?? '').toString().match(UUID_SUFFIX_RE);
  return match ? match[0] : null;
}
