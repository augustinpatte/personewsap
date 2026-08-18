import { useLanguage } from '@/contexts/LanguageContext';
import LegalPageShell from './legal/LegalPageShell';
import { legalCopy, SUPPORT_EMAIL } from './legal/legalCopy';

/**
 * The public support page, and the support URL given to the stores.
 *
 * The contact address is configuration, never a placeholder: inventing one
 * would send readers into a void. Until VITE_SUPPORT_EMAIL is set, the page
 * says so plainly instead of showing a fake address.
 */
const Support = () => {
  const { language } = useLanguage();
  const copy = legalCopy[language === 'fr' ? 'fr' : 'en'].support;

  return (
    <LegalPageShell eyebrow={copy.eyebrow} title={copy.title}>
      {copy.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}

      {copy.sections.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
          {section.bullets ? (
            <ul className="list-disc space-y-1.5 pl-5">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      <section className="space-y-3 rounded-lg border bg-muted/30 p-5">
        <h2 className="text-lg font-semibold tracking-tight">{copy.contactHeading}</h2>
        {SUPPORT_EMAIL ? (
          <p>
            {copy.contactConfigured(SUPPORT_EMAIL).split(SUPPORT_EMAIL)[0]}
            <a className="font-medium underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            {copy.contactConfigured(SUPPORT_EMAIL).split(SUPPORT_EMAIL)[1]}
          </p>
        ) : (
          <p className="text-muted-foreground">{copy.contactMissing}</p>
        )}
      </section>
    </LegalPageShell>
  );
};

export default Support;
