import { cn } from "@/lib/utils";

/**
 * The app icon beside a serif wordmark. The icon is the real App Store /
 * Google Play icon, so the site introduces the same mark people will later
 * find on their home screen.
 */
const BrandLogo = ({ className, tone = "ink" }: { className?: string; tone?: "ink" | "light" }) => (
  <span className={cn("inline-flex items-center gap-2.5", className)}>
    <img
      src="/app-icon-128.png"
      alt=""
      width={32}
      height={32}
      className="h-8 w-8 rounded-[9px] shadow-[0_1px_2px_rgba(10,107,232,0.25)]"
    />
    <span
      className={cn(
        "font-serif text-[1.3rem] font-semibold tracking-[-0.01em]",
        tone === "ink" ? "text-pn-ink" : "text-pn-night-ink"
      )}
    >
      PersoNews<span className={tone === "ink" ? "text-pn-teal" : "text-pn-night-teal"}>AP</span>
    </span>
  </span>
);

export default BrandLogo;
