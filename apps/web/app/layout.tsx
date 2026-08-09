import "./globals.css";
import "@ratio/ui/strip.css";
import "./skin.css";

import { Nav } from "./nav";
import { Sidebar } from "./sidebar";

export const metadata = {
  title: "ratio",
  description: "the likes are the referee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Sidebar />
          <div className="main-col">
            <Nav />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
