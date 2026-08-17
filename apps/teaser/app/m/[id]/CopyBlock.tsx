"use client";

import { useState } from "react";

/** The manual path under the post button: text shown in full + copy icon. */
export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <div className="copy-text">{text}</div>
      <button
        className="copy-btn"
        type="button"
        aria-label="copy"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}
