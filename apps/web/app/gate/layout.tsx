import type { Metadata } from "next";

/**
 * The gate is the only page a stranger can reach, so it carries the same
 * metadata override as /signup: the root layout sets title "ratio" and
 * description "the likes are the referee", which would put the product name in
 * the browser tab and in any link unfurl of the bare domain.
 *
 * Taking the wordmark off the card and leaving it in the tab would be a wall
 * with the name written on the door.
 *
 * In a layout rather than the page because page.tsx is a client component, and
 * client components cannot export metadata.
 */
export const metadata: Metadata = {
  title: "devnet beta",
  description: "",
  robots: { index: false, follow: false },
};

export default function GateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
