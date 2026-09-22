import React, { Suspense } from "react";
import { StaffActivatePasswordForm } from "@/components/staff/StaffActivatePasswordForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Activate Staff Password | WaffarhaCars",
  description: "Mandatory password activation for internal staff accounts.",
};

export default function StaffActivatePasswordPage() {
  return (
    <div className="py-8 sm:py-16 flex flex-col justify-center">
      <Suspense
        fallback={
          <div className="w-full max-w-md mx-auto h-96 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        }
      >
        <StaffActivatePasswordForm />
      </Suspense>
    </div>
  );
}
