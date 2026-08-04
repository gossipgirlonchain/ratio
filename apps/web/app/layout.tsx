import "./globals.css";
import "@ratio/ui/strip.css";

export const metadata = {
  title: "ratio",
  description: "the likes are the referee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
