import type { Metadata } from "next";

/**
 * Metadata override for the one page that must not name the product.
 *
 * The root layout sets title "ratio" and description "the likes are the
 * referee", which would show in the browser tab and, worse, in the link unfurl
 * when this URL gets posted. Unbranded has to include the card, or the page is
 * anonymous and the preview underneath it is not.
 *
 * It lives in a layout rather than the page because page.tsx is a client
 * component, and client components cannot export metadata.
 */
export const metadata: Metadata = {
  title: "two tweets go in. one comes out.",
  description: "a reply and the post it answers. most likes after 24 hours wins.",
  openGraph: {
    title: "two tweets go in. one comes out.",
    description: "a reply and the post it answers. most likes after 24 hours wins.",
  },
  twitter: {
    card: "summary",
    title: "two tweets go in. one comes out.",
    description: "a reply and the post it answers. most likes after 24 hours wins.",
  },
  // Nothing here should be indexed before launch.
  robots: { index: false, follow: false },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
