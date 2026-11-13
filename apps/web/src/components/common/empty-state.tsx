import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/40 px-6 py-12 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-[17px] bg-accent text-accent-foreground">
        <Icon aria-hidden className="size-6" strokeWidth={1.9} />
      </span>
      <h2 className="text-lg leading-6 font-extrabold">{title}</h2>
      {children && (
        <div className="max-w-sm text-[15px] leading-[22px] text-muted-foreground">{children}</div>
      )}
    </div>
  );
}
