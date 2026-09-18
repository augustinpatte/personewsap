import { useLanguage } from "@/contexts/LanguageContext";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { cn } from "@/lib/utils";

/**
 * EN / FR, as a two-button group. Uses the site's existing LanguageContext, so
 * the choice persists (localStorage `preferredLanguage`) and carries over to
 * the legal and account pages.
 */
const LanguageSwitch = ({ className, tone = "ink" }: { className?: string; tone?: "ink" | "light" }) => {
  const { setLanguage } = useLanguage();
  const { copy, lang } = useLandingCopy();

  return (
    <div
      role="group"
      aria-label={copy.a11y.language}
      className={cn(
        "inline-flex items-center rounded-full border p-0.5 text-[12px] font-semibold",
        tone === "ink" ? "border-pn-line bg-pn-surface" : "border-pn-night-line bg-pn-night-raised",
        className
      )}
    >
      {(["en", "fr"] as const).map((option) => {
        const active = lang === option;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            onClick={() => setLanguage(option)}
            aria-pressed={active}
            className={cn(
              "pn-focus min-w-[2.5rem] rounded-full px-2.5 py-1.5 tracking-[0.06em] transition-colors",
              active
                ? tone === "ink"
                  ? "bg-pn-ink text-pn-paper"
                  : "bg-pn-night-ink text-pn-night"
                : tone === "ink"
                  ? "text-pn-muted hover:text-pn-ink"
                  : "text-pn-night-soft hover:text-pn-night-ink"
            )}
          >
            {option.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
};

export default LanguageSwitch;
