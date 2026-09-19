import { CONTACT_EMAIL, CONTACT_MAILTO } from '@/lib/contact';

/**
 * A sentence of copy with the contact address in it, rendered with that
 * address as a mailto link. The copy stays plain text in legalCopy (so both
 * languages can be checked side by side); the link is added here, once.
 */
const ContactText = ({ text }: { text: string }) => {
  const at = text.indexOf(CONTACT_EMAIL);

  if (at === -1) {
    return <>{text}</>;
  }

  return (
    <>
      {text.slice(0, at)}
      <a className="font-medium underline underline-offset-2" href={CONTACT_MAILTO}>
        {CONTACT_EMAIL}
      </a>
      {text.slice(at + CONTACT_EMAIL.length)}
    </>
  );
};

export default ContactText;
