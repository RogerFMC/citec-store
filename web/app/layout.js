import Link from 'next/link';
import './globals.css';

const DEFAULT_TITLE = 'Citec Store';
const DEFAULT_DESCRIPTION =
  'Catálogo de tecnología — laptops, impresoras, monitores y más, con precios y stock actualizados.';

export const metadata = {
  title: {
    default: DEFAULT_TITLE,
    template: '%s',
  },
  description: DEFAULT_DESCRIPTION,
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    type: 'website',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">
              Citec Store
            </Link>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="container">
            <p>&copy; {new Date().getFullYear()} Citec Store</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
