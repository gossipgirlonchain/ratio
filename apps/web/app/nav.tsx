import Link from "next/link";

/**
 * Global navigation. Every page must work for a stranger arriving from a
 * shared link, so the nav is the same everywhere and says where you are
 * without needing context.
 */
export function Nav() {
  return (
    <nav className="nav">
      <Link className="nav-home" href="/">
        ratio
      </Link>
      <div className="nav-links">
        <Link href="/leaderboard">leaderboard</Link>
        <Link href="/search">search</Link>
        <Link href="/how">how it works</Link>
        <Link href="/wallet">wallet</Link>
      </div>
    </nav>
  );
}
