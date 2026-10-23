import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "../context/I18nContext";
import AppSurface from "../components/common/AppSurface";
import CapabilityNavigationBoundary from "../components/staff/CapabilityNavigationBoundary";

export const metadata: Metadata = {
  title: "WaffarhaCars | Cairo Car Care Marketplace Demo",
  description:
    "Interactive demo showcase: Reserve free, pay locked prices directly at the center, and confirm completion.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr">
      <body className="font-sans min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-brand-500 selection:text-white">
        <CapabilityNavigationBoundary />
        <I18nProvider>
          <AppSurface>{children}</AppSurface>
        </I18nProvider>
      </body>
    </html>
  );
}
