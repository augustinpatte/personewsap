import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Container = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("mx-auto w-full max-w-site px-5 sm:px-8", className)}>{children}</div>
);

export const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("pn-eyebrow text-pn-teal", className)}>{children}</p>
);

/**
 * Section opener: eyebrow, serif title, one short lede. `titleTail` is set in
 * the muted ink, the two-tone headline the page uses throughout.
 */
export const SectionHeading = ({
  id,
  eyebrow,
  title,
  titleTail,
  lede,
  align = "left",
  tone = "ink",
  className,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  titleTail?: string;
  lede?: string;
  align?: "left" | "center";
  tone?: "ink" | "light";
  className?: string;
}) => (
  <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
    <Eyebrow className={tone === "light" ? "text-pn-night-teal" : undefined}>{eyebrow}</Eyebrow>
    <h2
      id={id}
      className={cn(
        "mt-3 font-serif text-[2rem] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[2.6rem]",
        tone === "ink" ? "text-pn-ink" : "text-pn-night-ink"
      )}
    >
      {title}
      {titleTail ? (
        <>
          {" "}
          <span className={tone === "ink" ? "text-pn-muted" : "text-pn-night-soft"}>{titleTail}</span>
        </>
      ) : null}
    </h2>
    {lede ? (
      <p
        className={cn(
          "mt-4 text-[1.05rem] leading-relaxed sm:text-lg",
          tone === "ink" ? "text-pn-ink-soft" : "text-pn-night-soft"
        )}
      >
        {lede}
      </p>
    ) : null}
  </div>
);

/**
 * A small "Illustrative example" tag for every demo value on the page. Beside
 * a heading it stays on one line (shrink-0); stacked or inside a panel it
 * wraps, so a long French note never pushes the layout past a phone's width.
 */
export const DemoTag = ({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "light" }) => (
  <p
    className={cn(
      "inline-flex shrink-0 items-start gap-1.5 text-[12px] leading-[1.5]",
      tone === "ink" ? "text-pn-muted" : "text-pn-night-soft"
    )}
  >
    <span
      aria-hidden="true"
      className={cn("mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full", tone === "ink" ? "bg-pn-gold" : "bg-pn-night-gold")}
    />
    {children}
  </p>
);
