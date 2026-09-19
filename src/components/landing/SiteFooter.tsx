import { Link } from "react-router-dom";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/contact";
import BrandLogo from "./BrandLogo";
import LanguageSwitch from "./LanguageSwitch";
import { Container } from "./Section";
import { NAV_ITEMS } from "./navItems";

const linkClass = "pn-focus rounded text-pn-ink-soft transition-colors hover:text-pn-ink";

const SiteFooter = () => {
  const { copy } = useLandingCopy();
  const f = copy.footer;

  return (
    <footer className="border-t border-pn-line bg-pn-raised">
      <Container className="grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <BrandLogo />
          <p className="mt-4 text-[15px] leading-relaxed text-pn-ink-soft">{f.tagline}</p>
          <div className="mt-6 flex items-center gap-3">
            <span className="text-[13px] text-pn-muted">{f.language}</span>
            <LanguageSwitch />
          </div>
        </div>

        <nav aria-labelledby="footer-product">
          <h2 id="footer-product" className="pn-eyebrow font-sans text-pn-muted">
            {f.productHeading}
          </h2>
          <ul className="mt-4 space-y-2.5 text-[15px]">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className={linkClass}>
                  {copy.nav[item.key]}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-legal">
          <h2 id="footer-legal" className="pn-eyebrow font-sans text-pn-muted">
            {f.legalHeading}
          </h2>
          <ul className="mt-4 space-y-2.5 text-[15px]">
            <li>
              <Link to="/privacy" className={linkClass}>
                {f.privacy}
              </Link>
            </li>
            <li>
              <Link to="/support" className={linkClass}>
                {f.support}
              </Link>
            </li>
            <li>
              <a href={CONTACT_MAILTO} aria-label={f.contactLabel(CONTACT_EMAIL)} className={linkClass}>
                {CONTACT_EMAIL}
              </a>
            </li>
            <li>
              <Link to="/delete-account" className={linkClass}>
                {f.deleteAccount}
              </Link>
            </li>
            <li>
              <Link to="/login" className={linkClass}>
                {f.subscribers}
              </Link>
            </li>
          </ul>
        </nav>
      </Container>
      <Container className="border-t border-pn-line py-6 text-[13px] text-pn-muted">
        <p>{f.rights(new Date().getFullYear())}</p>
      </Container>
    </footer>
  );
};

export default SiteFooter;
