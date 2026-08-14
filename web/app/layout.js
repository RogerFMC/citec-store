import './globals.css';

export const metadata = {
  title: 'Citec Store',
  description: 'Catálogo de tecnología — laptops, impresoras, monitores y más.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
