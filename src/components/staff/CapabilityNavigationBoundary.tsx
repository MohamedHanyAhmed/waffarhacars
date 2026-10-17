"use client";

import { useLayoutEffect } from "react";

type Guard = (event: PopStateEvent) => void;
let active: { guard: Guard } | null = null;

/** A lease prevents an older/hidden workspace cleanup clearing a newer guard. */
export function protectCapabilityNavigation(guard: Guard): () => void {
  const lease = { guard };
  active = lease;
  return () => {
    if (active === lease) active = null;
  };
}

/**
 * Mounted in the root layout: register before App Router's passive popstate
 * effect. Window-target listeners otherwise run in registration order even
 * when a later page listener requests capture; Next may hide that page first.
 * No active capability lease means no interception or history mutation.
 */
export default function CapabilityNavigationBoundary() {
  useLayoutEffect(() => {
    const popstate = (event: PopStateEvent) => active?.guard(event);
    window.addEventListener("popstate", popstate, true);
    return () => window.removeEventListener("popstate", popstate, true);
  }, []);
  return null;
}
