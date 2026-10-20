import CustomerOfferDetail from "@/components/customer/discovery/CustomerOfferDetail";

export default async function CustomerOfferPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const { offerId } = await params;
  return <CustomerOfferDetail offerId={offerId} />;
}
