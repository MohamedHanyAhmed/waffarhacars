import React, { Suspense } from "react";
import { CustomerLoginForm } from "@/components/auth/CustomerLoginForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In | WaffarhaCars",
  description:
    "Customer mobile phone authentication via SMS OTP for WaffarhaCars Cairo marketplace.",
};

export default function LoginPage() {
  return (
    <div className="py-8 sm:py-16 flex flex-col justify-center">
      <Suspense
        fallback={
          <div className="w-full max-w-md mx-auto h-96 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        }
      >
        <CustomerLoginForm />
      </Suspense>
    </div>
  );
}
