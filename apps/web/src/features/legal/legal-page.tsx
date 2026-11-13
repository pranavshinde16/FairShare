import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '../../components/common/logo';

/** When the privacy notice and the terms last changed. */
export const LEGAL_UPDATED = '13 November 2026';

/** Where privacy requests and questions go: a build setting, else the project's public page. */
export const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || null;
export const PROJECT_URL = 'https://github.com/pranavshinde16/FairShare';

export function Contact() {
  return CONTACT_EMAIL ? (
    <a className="text-primary underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>
      {CONTACT_EMAIL}
    </a>
  ) : (
    <>
      the project’s page,{' '}
      <a className="text-primary underline underline-offset-4" href={PROJECT_URL}>
        {PROJECT_URL.replace('https://', '')}
      </a>{' '}
      (please don’t post personal details there; ask for a private contact instead)
    </>
  );
}

/** A plain reading page, open to anyone, signed in or not. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[680px] flex-col gap-7 bg-background px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <Logo size="lg" />
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-1 rounded-md text-[15px] font-bold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-focus-ring"
        >
          <ArrowLeft aria-hidden className="size-5" strokeWidth={1.9} />
          Back to FairShare
        </Link>
      </div>
      <article className="flex flex-col gap-4 text-[15px] leading-6 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:leading-6 [&_h2]:font-extrabold [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[30px] leading-9 font-extrabold tracking-[-0.03em]">{title}</h1>
          <p className="text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
        </header>
        {children}
      </article>
      <nav aria-label="Legal" className="flex gap-5 border-t pt-4 text-sm font-semibold">
        <Link to="/privacy" className="text-muted-foreground hover:text-foreground">
          Privacy notice
        </Link>
        <Link to="/terms" className="text-muted-foreground hover:text-foreground">
          Terms of use
        </Link>
      </nav>
    </main>
  );
}
