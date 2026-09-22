import React, { Suspense } from "react";
import { StaffDashboard } from "@/components/staff/StaffDashboard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Staff Portal | WaffarhaCars",
  description: "Internal staff operations dashboard with enforced MFA security.",
};

export default function StaffPage() {
  return (
    <div className="py-6 sm:py-10">
      <Suspense
        fallback={
          <div className="w-full max-w-3xl mx-auto h-96 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        }
      >
        <StaffDashboard />
      </Suspense>
    </div>
  );
}
