import "./globals.css";
import "@ratio/ui/strip.css";
import "./skin.css";

import { ScannerPanel } from "../components/ScannerPanel";
import { Nav } from "./nav";
import { Providers } from "./providers";
import { Sidebar } from "./sidebar";

export const metadata = {
  title: "ratio",
  description: "the likes are the referee",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* theme before first paint: no flash, remembered choice */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.dataset.theme = localStorage.getItem("ratio-theme") || "dark";`,
          }}
        />
        <Providers>
          <div className="shell">
            <Sidebar />
            <div className="main-col">
              <Nav />
              {children}
            </div>
          </div>
          {/* layout-mounted so the conversation survives navigation */}
          <ScannerPanel />
        </Providers>
      </body>
    </html>
  );
}
