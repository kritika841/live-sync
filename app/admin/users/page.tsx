import { redirect } from "next/navigation";
import { requirePageAdmin } from "../../../lib/auth/access";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requirePageAdmin();
  redirect("/?view=users");
}

