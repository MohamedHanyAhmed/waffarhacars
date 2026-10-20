"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DemoStateProvider } from "@/context/DemoStateContext";
import { DemoBanner } from "./DemoBanner";
import { LocalizedFooter } from "./LocalizedFooter";

/** Customer reads never mount the showcase repository or simulated navigation. */
export default function AppSurface({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!pathname) return null;
  if (pathname === "/customer" || pathname.startsWith("/customer/")) return children;
  return (
    <DemoStateProvider>
      <DemoBanner />
      <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      <LocalizedFooter />
    </DemoStateProvider>
  );
}
