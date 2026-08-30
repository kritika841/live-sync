import { requireChatGPTUser } from "./chatgpt-auth";
import OrdersDashboard from "./OrdersDashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = process.env.NODE_ENV === "production" ? await requireChatGPTUser("/") : null;
  return <OrdersDashboard userLabel={user?.displayName || "Private dashboard"} />;
}
