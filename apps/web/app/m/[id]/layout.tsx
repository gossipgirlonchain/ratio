/**
 * Server shell for the market page: this is where the share metadata
 * lives (the page itself is a client component and cannot export it).
 * The colocated opengraph-image route gives Next the og:image and
 * twitter:image URLs automatically; twitter:card=summary_large_image is
 * what makes X render the big card instead of a thumbnail.
 */
import type { Metadata } from "next";

import { supabaseAdmin } from "../../../lib/supabaseServer";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  let title = "ratio";
  try {
    const { data } = await supabaseAdmin()
      .from("markets")
      .select("author_a_handle, author_b_handle")
      .eq("id", params.id)
      .maybeSingle();
    if (data) title = `@${data.author_a_handle} vs @${data.author_b_handle} · ratio`;
  } catch {
    // metadata degrades to the bare wordmark, never breaks the page
  }
  return {
    title,
    openGraph: { title },
    twitter: { card: "summary_large_image", title },
  };
}

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return children;
}
