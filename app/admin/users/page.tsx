import Link from "next/link";
import Image from "next/image";
import { requirePageAdmin } from "../../../lib/auth/access";
import AdminUsers from "./AdminUsers";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requirePageAdmin();
  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <Link href="/" className="admin-brand"><Image src="/satmi-logo.svg" alt="Satmi" width={86} height={54} priority /></Link>
        <div><span>{user.name}</span><strong>Administrator</strong></div>
        <Link href="/" className="admin-back">Back to dashboard</Link>
      </header>
      <AdminUsers currentUserId={user.id} />
    </main>
  );
}
