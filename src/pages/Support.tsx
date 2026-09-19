import { useLanguage } from '@/contexts/LanguageContext';
import LegalPageShell from './legal/LegalPageShell';
import ContactText from '@/components/ContactText';
import { legalCopy } from './legal/legalCopy';

/**
 * The public support page, and the support URL given to the stores.
 *
 * The contact line shows the one official address (src/lib/contact.ts) as a
 * mailto link: the same address the privacy page, the account-deletion page
 * and the site footer give.
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
        <p>
          <ContactText text={copy.contactBody} />
        </p>
      </section>
    </LegalPageShell>
  );
};

export default Support;
