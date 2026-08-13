'use client';

import { FormEvent, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, LockKeyhole } from 'lucide-react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Unable to unlock the dashboard.');
      window.location.assign('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to unlock the dashboard.');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center px-5 py-10">
    <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-white/10 bg-[#001f35]/85 p-7 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-9">
      <div className="flex h-14 w-20 items-center justify-center rounded-xl border border-white/10 bg-white/[.06] px-2"><Image src="/bny-logo.svg" alt="BNY" width={160} height={48} className="h-auto w-full" priority /></div>
      <div className="mt-8 flex h-11 w-11 items-center justify-center rounded-2xl bg-bny-teal/15 text-bny-teal"><LockKeyhole className="h-5 w-5" /></div>
      <p className="mt-5 text-[11px] font-bold uppercase tracking-[.22em] text-bny-teal">Workplace automation</p>
      <h1 className="mt-2 text-2xl font-semibold text-bny-paper">Client Meeting Intelligence</h1>
      <p className="mt-3 text-sm leading-6 text-bny-paper/60">Enter the shared dashboard password to view and manage team client meeting data.</p>
      <label className="mt-7 block text-xs font-bold uppercase tracking-[.14em] text-bny-paper/55">Password
        <input autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-bny-deep/65 px-4 py-3 text-base normal-case tracking-normal text-bny-paper outline-none transition placeholder:text-bny-paper/30 focus:border-bny-teal" placeholder="Enter password" required />
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-red-200">{error}</p>}
      <button disabled={submitting} type="submit" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-bny-teal px-4 py-3 text-sm font-bold text-bny-deep transition hover:bg-[#8adbe2] disabled:cursor-wait disabled:opacity-70">{submitting ? 'Unlocking…' : 'Continue'} <ArrowRight className="h-4 w-4" /></button>
    </form>
  </main>;
}
