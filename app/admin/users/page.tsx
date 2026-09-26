import Link from "next/link";
import { requirePageAdmin } from "../../../lib/auth/access";
import AdminUsers from "./AdminUsers";
import ThemeToggle from "../../../components/ThemeToggle";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requirePageAdmin();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/90 bg-card/95 px-5 lg:px-8 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex flex-col items-start gap-1">
            <div className="relative flex items-center">
              <img
                src="/logo-light.png"
                alt="Satmi"
                className="h-7 w-auto max-w-[120px] object-contain dark:hidden"
              />
              <img
                src="/logo-dark.png"
                alt="Satmi"
                className="hidden h-7 w-auto max-w-[120px] object-contain dark:block"
              />
            </div>
            <span className="text-[13px] font-semibold tracking-tight text-foreground">
              Satmi Ops
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs">
            <ShieldCheck size={14} className="text-primary" />
            <span className="font-semibold text-foreground">{user.name}</span>
            <span className="text-muted-foreground text-[11px]">(Administrator)</span>
          </div>

          <ThemeToggle />

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-ring/50 hover:bg-muted"
          >
            <ArrowLeft size={14} />
            <span>Back to dashboard</span>
          </Link>
        </div>
      </header>

      <main className="page-container">
        <AdminUsers currentUserId={user.id} />
      </main>
    </div>
  );
}
