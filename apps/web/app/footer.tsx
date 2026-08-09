import Link from "next/link";

/** Footer: the info pages. None of these belong in the top bar. */
export function Footer() {
  return (
    <footer className="footer">
      <Link href="/how">how it works</Link>
      <Link href="/extension">extension</Link>
      <Link href="/terms">terms</Link>
      <Link href="/privacy">privacy</Link>
    </footer>
  );
}
