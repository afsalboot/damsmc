import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return <section className="mx-auto grid min-h-[70dvh] max-w-xl place-items-center p-4">
    <div className="card w-full p-6 text-center sm:p-8">
      <SearchX className="mx-auto mb-4 text-[var(--green)]" size={32} aria-hidden="true" />
      <p className="label">Page not found</p>
      <h1 className="text-2xl font-extrabold">We could not find this page</h1>
      <p className="mt-3 text-[var(--muted)]">The address may have changed. Return to the dashboard to continue.</p>
      <Link className="btn btn-primary mt-6" href="/dashboard">Go to dashboard</Link>
    </div>
  </section>;
}
