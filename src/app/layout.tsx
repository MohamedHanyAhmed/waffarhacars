import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "../context/I18nContext";
import { DemoStateProvider } from "../context/DemoStateContext";
import { DemoBanner } from "../components/common/DemoBanner";
import { LocalizedFooter } from "../components/common/LocalizedFooter";

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
        <I18nProvider>
          <DemoStateProvider>
            <DemoBanner />
            <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">{children}</main>
            <LocalizedFooter />
          </DemoStateProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
