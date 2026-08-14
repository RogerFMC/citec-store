import Link from 'next/link';
import './globals.css';

export const metadata = {
  title: {
    default: 'Citec Store',
    template: '%s',
  },
  description:
    'Catálogo de tecnología — laptops, impresoras, monitores y más, con precios y stock actualizados.',
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
