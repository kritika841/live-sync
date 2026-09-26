import { redirect, notFound } from "next/navigation";
import { currentDashboardUser } from "../../../lib/auth/access";
import SignInForm from "../SignInForm";
import ThemeToggle from "../../../components/ThemeToggle";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

const publicViews = new Set(["sign-in"]);

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (!publicViews.has(path)) notFound();

  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  const user = configured ? await currentDashboardUser() : null;
  if (user) redirect("/");

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background text-foreground">
      {/* Top right theme toggle */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Brand Column (Desktop left column / Mobile header) */}
      <section className="relative flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-border bg-card p-8 lg:p-14 lg:w-[480px] xl:w-[540px] shrink-0">
        <div>
          <div className="flex flex-col items-start gap-1 mb-10">
            <div className="relative flex items-center">
              <img
                src="/logo-light.png"
                alt="Satmi"
                className="h-8 w-auto max-w-[130px] object-contain dark:hidden"
              />
              <img
                src="/logo-dark.png"
                alt="Satmi"
                className="hidden h-8 w-auto max-w-[130px] object-contain dark:block"
              />
            </div>
            <span className="text-base font-semibold tracking-tight text-foreground">
              Satmi Ops
            </span>
          </div>

          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
              <ShieldCheck size={14} /> Private operations workspace
            </span>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-foreground leading-tight">
              Shiprocket orders, secured for your team.
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Real-time synchronization, fraud risk monitoring, and seamless order fulfillment control.
            </p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-border hidden lg:block">
          <p className="text-xs text-muted-foreground">
            Access is invitation-only. Every account has its own password and revocable session.
          </p>
        </div>
      </section>

      {/* Form Column */}
      <section className="flex flex-1 items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Sign in to your account</h2>
            <p className="text-xs text-muted-foreground">
              Enter your authorized email address and password below
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-soft dark:shadow-none">
            <SignInForm configured={configured} />
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Need access? Ask a Satmi administrator to invite your email address.
          </p>
        </div>
      </section>
    </div>
  );
}
