import type { Metadata } from "next";
import type { ReactNode } from "react";
import CustomerDiscoveryShell from "@/components/customer/discovery/CustomerDiscoveryShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Service offers | WaffarhaCars",
  description:
    "Read published car-care service terms and listed vehicle coverage. Reservations are not available.",
  robots: { index: false, follow: false },
};

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return <CustomerDiscoveryShell>{children}</CustomerDiscoveryShell>;
}
