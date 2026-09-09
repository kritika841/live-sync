import OrdersDashboard from "./OrdersDashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <OrdersDashboard userLabel="Operations" />;
}
