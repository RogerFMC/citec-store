import { notFound } from 'next/navigation';
import { getProductById } from '../../../lib/catalogSearch.js';
import { extractProductId } from '../../../lib/slug.js';
import { formatPrice, formatLeadTime, stockLabel, buildWhatsappUrl } from '../../../lib/format.js';

export const revalidate = 3600;

const WHATSAPP_PHONE = '51969328181';

export async function generateMetadata({ params }) {
  const { slugId } = await params;
  const id = extractProductId(slugId);
  if (!id) return {};

  const product = await getProductById(id);
  if (!product) return {};

  return {
    title: `${product.model} | Citec Store`,
    description: `${product.model}${product.brand ? ' — ' + product.brand : ''} — ${formatPrice(
      product.final_price
    )}. ${stockLabel(product.stock_status)} en Citec Store.`,
  };
}

export default async function ProductPage({ params }) {
  const { slugId } = await params;
  const id = extractProductId(slugId);
  if (!id) {
    notFound();
  }

  const product = await getProductById(id);
  if (!product) {
    notFound();
  }

  const whatsappUrl = buildWhatsappUrl({ phone: WHATSAPP_PHONE, productName: product.model });
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.model,
    brand: product.brand || undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'PEN',
      price: product.final_price,
      availability:
        product.stock_status === 'out_of_stock'
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
    },
  };

  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="product-detail">
        <h1>{product.model}</h1>
        {product.brand && <p>Marca: {product.brand}</p>}
        <p className="price">{formatPrice(product.final_price)}</p>
        <p>{stockLabel(product.stock_status)}</p>
        <p>{formatLeadTime(product.max_lead_days)}</p>
        {product.warehouse_city && (
          <p>
            Despacho desde: {product.warehouse_name} ({product.warehouse_city})
          </p>
        )}
        <a className="whatsapp-button" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          Consultar por WhatsApp
        </a>
      </div>
    </main>
  );
}
