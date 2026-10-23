import { Suspense } from "react";
import CustomerOfferList from "@/components/customer/discovery/CustomerOfferList";

export default function CustomerOffersPage() {
  return (
    <Suspense>
      <CustomerOfferList />
    </Suspense>
  );
}
