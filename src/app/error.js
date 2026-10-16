"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function ErrorPage({ retry }) {
  return <section className="mx-auto grid min-h-[70dvh] max-w-xl place-items-center p-4">
    <div className="card w-full p-6 text-center sm:p-8" role="alert">
      <AlertTriangle className="mx-auto mb-4 text-[var(--red)]" size={32} aria-hidden="true" />
      <h1 className="text-2xl font-extrabold">This screen could not load</h1>
      <p className="mt-3 text-[var(--muted)]">Try loading it again. If the problem continues, return to the dashboard and contact the store administrator.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" className="btn btn-primary" onClick={() => retry()}><RefreshCw size={17} />Try again</button>
        <Link className="btn" href="/dashboard">Go to dashboard</Link>
      </div>
    </div>
  </section>;
}
