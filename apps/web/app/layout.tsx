import "./globals.css";
import "@ratio/ui/strip.css";
import "./skin.css";

import { Nav } from "./nav";

export const metadata = {
  title: "ratio",
  description: "the likes are the referee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
