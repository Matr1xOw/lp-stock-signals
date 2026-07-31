import "./globals.css";

export const metadata = {
  title: "LP Stock Signals",
  description: "Stock signaler with technical analysis and position tracking",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
