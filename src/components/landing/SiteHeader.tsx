import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { cn } from "@/lib/utils";
import BrandLogo from "./BrandLogo";
import LanguageSwitch from "./LanguageSwitch";
import { NAV_ITEMS } from "./navItems";


const SiteHeader = () => {
  const { copy } = useLandingCopy();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onResize = () => window.innerWidth >= 1024 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-colors duration-300",
        scrolled || open ? "border-pn-line bg-pn-paper/90 backdrop-blur-md" : "border-transparent bg-pn-paper"
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-site items-center justify-between gap-4 px-5 sm:px-8">
        <a href="#top" aria-label={copy.a11y.home} className="pn-focus -m-1 rounded-lg p-1">
          <BrandLogo />
        </a>

        <nav aria-label={copy.a11y.mainNav} className="hidden lg:block">
          <ul className="flex items-center gap-8 text-[14px] font-medium text-pn-ink-soft">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="pn-focus rounded transition-colors hover:text-pn-ink">
                  {copy.nav[item.key]}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2.5">
          <LanguageSwitch className="hidden sm:inline-flex" />
          <a
            href="#download"
            className="pn-focus hidden rounded-full bg-pn-ink px-4 py-2 text-[13.5px] font-semibold text-pn-paper transition-colors hover:bg-pn-teal-deep sm:inline-flex"
          >
            {copy.nav.cta}
          </a>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? copy.a11y.closeMenu : copy.a11y.openMenu}
            className="pn-focus inline-flex h-10 w-10 items-center justify-center rounded-full border border-pn-line bg-pn-surface text-pn-ink lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <div id="mobile-menu" hidden={!open} className="border-t border-pn-line lg:hidden">
        <nav aria-label={copy.a11y.mainNav} className="mx-auto w-full max-w-site px-5 pb-6 pt-2 sm:px-8">
          <ul className="divide-y divide-pn-line">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={() => setOpen(false)}
                  className="pn-focus flex py-3.5 font-serif text-xl font-semibold text-pn-ink"
                >
                  {copy.nav[item.key]}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-3">
            <LanguageSwitch />
            <a
              href="#download"
              onClick={() => setOpen(false)}
              className="pn-focus inline-flex rounded-full bg-pn-ink px-4 py-2.5 text-[14px] font-semibold text-pn-paper"
            >
              {copy.nav.cta}
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
};

export default SiteHeader;
