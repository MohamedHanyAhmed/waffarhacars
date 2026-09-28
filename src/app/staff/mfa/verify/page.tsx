import React, { Suspense } from "react";
import { StaffMfaVerifyForm } from "@/components/staff/StaffMfaVerifyForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MFA Verification | WaffarhaCars",
  description: "Mandatory TOTP two-factor verification for internal staff sign-in.",
};

export default function StaffMfaVerifyPage() {
  return (
    <div className="py-8 sm:py-16 flex flex-col justify-center">
      <Suspense
        fallback={
          <div className="w-full max-w-md mx-auto h-96 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        }
      >
        <StaffMfaVerifyForm />
      </Suspense>
    </div>
  );
}
