import "./globals.css";
import "./skin.css";

import Link from "next/link";

export const metadata = {
  title: "reply score",
  description: "how much of a reply guy are you. the likes are the referee.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-paint theme script mutates <html>
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        {/* theme before first paint, shared key with the app */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.dataset.theme = localStorage.getItem("ratio-theme") || "dark";`,
          }}
        />
        <div className="wrap">
          <div className="masthead">
            <Link href="/" className="wordmark">ratio</Link>
            <span className="tag">the likes are the referee</span>
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
