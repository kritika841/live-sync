import { notFound } from "next/navigation";
import OrdersDashboard from "../OrdersDashboard";
export const dynamic = "force-dynamic";
export default function Preview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <>
      <OrdersDashboard
        userLabel="Preview"
        userEmail="kritika@satmi.in"
        userRole="admin"
        isAdmin
        preview
      />
    </>
  );
}
