const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://citec-store.vercel.app';

export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/buscar'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
