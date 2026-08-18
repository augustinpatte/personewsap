import { useLanguage } from '@/contexts/LanguageContext';
import LegalPageShell from './legal/LegalPageShell';
import { LEGAL_LAST_UPDATED, legalCopy } from './legal/legalCopy';

/**
 * The public privacy policy, and the URL given to the App Store and Google
 * Play. It describes the product as built: four editions a week, a self-paced
 * learning path, one notification per published edition.
 */
const Privacy = () => {
  const { language } = useLanguage();
  const copy = legalCopy[language === 'fr' ? 'fr' : 'en'].privacy;

  return (
    <LegalPageShell eyebrow={copy.eyebrow} title={copy.title}>
      <p className="text-sm text-muted-foreground">{copy.updated(LEGAL_LAST_UPDATED)}</p>

      {copy.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}

      {copy.sections.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.bullets ? (
            <ul className="list-disc space-y-1.5 pl-5">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </LegalPageShell>
  );
};

export default Privacy;
