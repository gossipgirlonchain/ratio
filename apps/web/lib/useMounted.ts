"use client";

import { useEffect, useState } from "react";

/** Fixture pages derive from Date.now(); mount-gate skips SSR mismatch. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
