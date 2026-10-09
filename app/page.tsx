import OrdersDashboard from "./OrdersDashboard";
import { isAdmin, requirePageUser } from "../lib/auth/access";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePageUser();
  const params = searchParams ? await searchParams : {};
  const initialView = typeof params?.view === "string" ? params.view : undefined;
  return (
    <OrdersDashboard
      initialView={initialView}
      userId={user.id}
      userLabel={user.name}
      userEmail={user.email}
      userRole={user.role}
      isAdmin={isAdmin(user)}
    />
  );
}
