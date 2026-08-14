const priceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPrice(value) {
  return `S/ ${priceFormatter.format(Number(value))}`;
}

export function formatLeadTime(maxLeadDays) {
  if (maxLeadDays === null || maxLeadDays === undefined) {
    return 'Consultar plazo de entrega';
  }
  if (maxLeadDays <= 0) {
    return 'Entrega el mismo día (según stock y ciudad)';
  }
  if (maxLeadDays === 1) {
    return 'Entrega en 1 día hábil';
  }
  return `Entrega en hasta ${maxLeadDays} días hábiles`;
}

export function stockLabel(status) {
  if (status === 'in_stock') return 'En stock';
  if (status === 'low_stock') return 'Últimas unidades';
  return 'Consultar disponibilidad';
}

export function buildWhatsappUrl({ phone, productName }) {
  const message = `Hola, estoy interesado en: ${productName}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
