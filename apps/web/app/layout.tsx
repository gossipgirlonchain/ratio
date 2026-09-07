import "./globals.css";
import "@ratio/ui/strip.css";
import "./skin.css";

import { Chrome } from "./chrome";
import { Providers } from "./providers";

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
          <Chrome>{children}</Chrome>
        </Providers>
      </body>
    </html>
  );
}
