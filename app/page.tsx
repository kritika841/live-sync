import OrdersDashboard from "./OrdersDashboard";
import { isAdmin, requirePageUser } from "../lib/auth/access";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requirePageUser();
  return <OrdersDashboard userLabel={user.name} userEmail={user.email} userRole={user.role} isAdmin={isAdmin(user)} />;
}
