import Image from "next/image";
import { redirect, notFound } from "next/navigation";
import { currentDashboardUser } from "../../../lib/auth/access";
import SignInForm from "../SignInForm";

export const dynamic = "force-dynamic";

const publicViews = new Set(["sign-in"]);

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (!publicViews.has(path)) notFound();

  const user = await currentDashboardUser();
  if (user) redirect("/");

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <Image src="/satmi-logo.svg" alt="Satmi" width={150} height={96} style={{ height: "auto" }} priority />
        <div>
          <p className="eyebrow">Private operations workspace</p>
          <h1>Shiprocket orders, secured for your team.</h1>
          <p>Access is invitation-only. Every account has its own password and revocable session.</p>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <SignInForm />
          <p className="auth-help">Need access? Ask a Satmi administrator to add your email address.</p>
        </div>
      </section>
    </main>
  );
}
