import Link from 'next/link';

/** A tappable glass card that opens a screen: kicker, title, one line, arrow. */
export default function IndexCard({
  href,
  kicker,
  title,
  text,
  i = 0,
}: {
  href: string;
  kicker: string;
  title: string;
  text: string;
  i?: number;
}) {
  return (
    <Link
      href={href}
      className="glass tap rise group flex items-center justify-between gap-4 p-5"
      style={{ '--i': i } as React.CSSProperties}
    >
      <span className="flex flex-col gap-1">
        <span className="label text-cyan-ink">{kicker}</span>
        <span className="text-[19px] font-medium leading-snug tracking-[-0.01em]">{title}</span>
        <span className="text-sm leading-snug text-muted">{text}</span>
      </span>
      <span
        aria-hidden="true"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors group-hover:bg-ink group-hover:text-white"
      >
        →
      </span>
    </Link>
  );
}
