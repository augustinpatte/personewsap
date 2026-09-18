import { useLandingCopy } from "@/landing/useLandingCopy";
import { cn } from "@/lib/utils";

/**
 * "Coming soon" store tiles. Deliberately NOT the official badges and NOT
 * links: the apps are not in either store yet, and an official badge or a
 * store URL would promise a download that does not exist. When the listings
 * go live, replace these with the official badges and the real URLs.
 */

const AppleGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[1.35em] w-[1.35em] fill-current">
    <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.33-3.5ZM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22Z" />
  </svg>
);

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[1.25em] w-[1.25em]">
    <path
      d="M5 3.8v16.4c0 .6.66.97 1.17.66l13.3-8.2a.78.78 0 0 0 0-1.32L6.17 3.14A.77.77 0 0 0 5 3.8Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path d="M5.4 3.6 14.6 12l-9.2 8.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

const Tile = ({
  glyph,
  store,
  label,
  soon,
  tone,
}: {
  glyph: JSX.Element;
  store: string;
  label: string;
  soon: string;
  tone: "ink" | "light";
}) => (
  <li
    className={cn(
      "flex min-w-[10.5rem] items-center gap-3 rounded-2xl border px-4 py-2.5",
      tone === "ink"
        ? "border-pn-line-strong bg-pn-surface text-pn-ink"
        : "border-pn-night-line bg-pn-night-raised text-pn-night-ink"
    )}
  >
    <span className="sr-only">{label}</span>
    <span aria-hidden="true" className="contents">{glyph}</span>
    <span aria-hidden="true" className="flex flex-col leading-tight">
      <span
        className={cn(
          "text-[10.5px] font-semibold uppercase tracking-[0.14em]",
          tone === "ink" ? "text-pn-teal" : "text-pn-night-teal"
        )}
      >
        {soon}
      </span>
      <span className="text-[1.05rem] font-semibold tracking-[-0.01em]">{store}</span>
    </span>
  </li>
);

const StoreBadges = ({ className, tone = "ink" }: { className?: string; tone?: "ink" | "light" }) => {
  const { copy } = useLandingCopy();

  return (
    <ul className={cn("flex flex-wrap gap-3", className)}>
      <Tile
        glyph={<AppleGlyph />}
        store={copy.stores.appStore}
        label={copy.stores.appStoreLabel}
        soon={copy.stores.comingSoon}
        tone={tone}
      />
      <Tile
        glyph={<PlayGlyph />}
        store={copy.stores.googlePlay}
        label={copy.stores.googlePlayLabel}
        soon={copy.stores.comingSoon}
        tone={tone}
      />
    </ul>
  );
};

export default StoreBadges;
