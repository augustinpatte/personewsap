import type { ReactNode } from "react";
import { BatteryFull, CheckSquare, Compass, Briefcase, FileText, Signal, Users, Wifi } from "lucide-react";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { cn } from "@/lib/utils";

/**
 * A phone drawn in CSS. Every inner size is in `em`, so the whole device —
 * type included — scales from the font-size set on (or inherited by) the
 * frame. Screens inside are illustrations: hidden from assistive technology,
 * with the frame's `label` as the single description.
 */
export const PhoneFrame = ({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) => (
  <div
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    className={cn(
      "relative h-[41.5em] w-[20em] shrink-0 rounded-[3em] bg-[#1C1A16] p-[0.5em] shadow-pn-phone ring-1 ring-black/10",
      className
    )}
  >
    <div aria-hidden="true" className="relative h-full w-full overflow-hidden rounded-[2.55em] bg-pn-paper">
      <div className="absolute left-1/2 top-[0.55em] z-20 h-[1.55em] w-[5.6em] -translate-x-1/2 rounded-full bg-black" />
      {children}
    </div>
  </div>
);

export const StatusBar = () => (
  <div className="flex items-center justify-between px-[1.7em] pt-[0.85em] text-pn-ink">
    <span className="text-[0.78em] font-semibold tracking-[-0.01em]">9:41</span>
    <span className="flex items-center gap-[0.3em]">
      <Signal className="h-[0.85em] w-[0.85em]" strokeWidth={2.4} />
      <Wifi className="h-[0.85em] w-[0.85em]" strokeWidth={2.4} />
      <BatteryFull className="h-[1em] w-[1em]" strokeWidth={2} />
    </span>
  </div>
);

type TabKey = "newsletter" | "cases" | "stories" | "path" | "teams";

const TABS: { key: TabKey; Icon: typeof FileText }[] = [
  { key: "newsletter", Icon: FileText },
  { key: "cases", Icon: CheckSquare },
  { key: "stories", Icon: Briefcase },
  { key: "path", Icon: Compass },
  { key: "teams", Icon: Users },
];

/** The app's floating tab bar, with its five real tabs. */
export const AppTabBar = ({ active }: { active: TabKey }) => {
  const { copy } = useLandingCopy();

  return (
    <div className="absolute inset-x-[0.75em] bottom-[0.8em] z-10 flex items-stretch justify-between rounded-[1.5em] border border-pn-line bg-pn-surface/90 px-[0.35em] py-[0.35em] shadow-[0_8px_24px_-12px_rgba(28,26,22,0.35)] backdrop-blur-md">
      {TABS.map(({ key, Icon }) => (
        <span
          key={key}
          className={cn(
            "flex flex-1 flex-col items-center gap-[0.2em] rounded-[1.1em] py-[0.45em]",
            key === active ? "bg-pn-teal-soft text-pn-teal" : "text-pn-muted"
          )}
        >
          <Icon className="h-[1.05em] w-[1.05em]" strokeWidth={key === active ? 2.2 : 1.8} />
          <span className="text-[0.52em] font-semibold leading-none">{copy.app.tabs[key]}</span>
        </span>
      ))}
    </div>
  );
};

/** A phone-top crop: the upper part of an app screen, for use inside cards. */
export const AppSurface = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div
    aria-hidden="true"
    className={cn(
      "relative overflow-hidden rounded-t-[1.6em] border border-b-0 border-pn-line bg-pn-paper px-[1.1em] pt-[1.1em]",
      className
    )}
  >
    {children}
  </div>
);
