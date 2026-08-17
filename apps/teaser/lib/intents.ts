/**
 * X web intents. The composer opens preloaded; one tap to post.
 * `quoteOf` rides the url= param: X renders a trailing tweet URL as the
 * quoted tweet, which is how the user's QT attaches their own reply.
 */

export const userPostIntent = (text: string, quoteOf?: string): string => {
  const p = new URLSearchParams({ text });
  if (quoteOf) p.set("url", quoteOf);
  return `https://x.com/intent/post?${p.toString()}`;
};

/** Mock status URL for a mock tweet id (real provider returns real URLs). */
export const tweetUrl = (handle: string, tweetId: string): string =>
  `https://x.com/${handle}/status/${tweetId.replace(/[^a-z0-9]/gi, "")}`;
