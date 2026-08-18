import { Link } from 'react-router-dom';
import BrandHeader from '@/components/BrandHeader';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ReactNode } from 'react';

/**
 * Shared frame for the three public pages the stores require (privacy, support,
 * account deletion). It reuses the site's existing masthead and type so a legal
 * page reads as part of the product rather than a bolted-on document, and it
 * carries the language switch those pages need — they are frequently reached
 * from a store listing rather than from inside the site.
 */
const LegalPageShell = ({
  eyebrow,
  title,
  children
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) => {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="min-h-screen bg-background px-5 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <BrandHeader />

        <div className="mb-10 flex items-center justify-between gap-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
          <div className="flex items-center gap-1 text-xs">
            {(['fr', 'en'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLanguage(option)}
                aria-pressed={language === option}
                className={
                  language === option
                    ? 'rounded-full bg-foreground px-3 py-1 font-semibold text-background'
                    : 'rounded-full px-3 py-1 text-muted-foreground hover:text-foreground'
                }
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <h1
          className="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ fontFamily: '"Source Serif 4", Georgia, serif' }}
        >
          {title}
        </h1>

        <div className="space-y-8 text-[15px] leading-relaxed text-foreground/90">
          {children}
        </div>

        <nav className="mt-16 flex flex-wrap gap-x-6 gap-y-2 border-t pt-6 text-sm text-muted-foreground">
          <Link className="hover:text-foreground" to="/">
            PersoNewsAP
          </Link>
          <Link className="hover:text-foreground" to="/privacy">
            {language === 'fr' ? 'Confidentialité' : 'Privacy'}
          </Link>
          <Link className="hover:text-foreground" to="/support">
            {language === 'fr' ? 'Assistance' : 'Support'}
          </Link>
          <Link className="hover:text-foreground" to="/delete-account">
            {language === 'fr' ? 'Supprimer le compte' : 'Delete account'}
          </Link>
        </nav>
      </div>
    </div>
  );
};

export default LegalPageShell;
