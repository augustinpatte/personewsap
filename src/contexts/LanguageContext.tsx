import React, { createContext, useContext, useState, ReactNode } from 'react';

export type Language = 'fr' | 'en' | null;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations: Record<string, Record<string, string>> = {
  // Navigation
  'nav.back': { fr: 'Retour', en: 'Back' },
  'nav.continue': { fr: 'Continuer', en: 'Continue' },
  'nav.signup': { fr: "S'inscrire", en: 'Sign up' },
  
  // Language selection page
  'lang.title': { fr: 'Choisissez votre langue', en: 'Choose your language' },
  'lang.subtitle': { fr: 'Cette langue sera utilisée pour toute l\'interface', en: 'This language will be used for the entire interface' },
  
  // Topics page
  'topics.title': { fr: 'Sélectionnez vos sujets', en: 'Select your topics' },
  'topics.subtitle': { fr: 'Choisissez les sujets qui vous intéressent', en: 'Choose the topics that interest you' },
  'topics.sport': { fr: 'Sport', en: 'Sports' },
  'topics.international': { fr: 'International', en: 'International' },
  'topics.finance': { fr: 'Finance / Économie', en: 'Finance / Economy' },
  'topics.stocks': { fr: 'Marché actions', en: 'Stock Market' },
  'topics.automotive': { fr: 'Industrie automobile', en: 'Automotive industry' },
  'topics.pharma': { fr: 'Industrie pharmaceutique', en: 'Pharmaceutical industry' },
  'topics.ai': { fr: 'Intelligence artificielle', en: 'Artificial Intelligence' },
  'topics.culture': { fr: 'Culture', en: 'Culture' },
  
  // Articles page
  'articles.title': { fr: 'Nombre d\'articles par sujet', en: 'Number of articles per topic' },
  'articles.subtitle': { fr: 'Définissez combien d\'articles vous souhaitez recevoir', en: 'Define how many articles you want to receive' },
  'articles.count': { fr: 'articles', en: 'articles' },
  'articles.article': { fr: 'article', en: 'article' },
  
  // Signup page
  'signup.title': { fr: 'Inscription', en: 'Sign Up' },
  'signup.subtitle': { fr: 'Finalisez votre inscription à la newsletter', en: 'Complete your newsletter subscription' },
  'signup.firstname': { fr: 'Prénom', en: 'First name' },
  'signup.lastname': { fr: 'Nom', en: 'Last name' },
  'signup.email': { fr: 'Email', en: 'Email' },
  'signup.phone': { fr: 'Numéro de téléphone', en: 'Phone number' },
  'signup.phone.optional': { fr: '(optionnel)', en: '(optional)' },
  'signup.phone.notice': {
    fr: 'Si vous renseignez votre numéro, vous serez ajouté manuellement à un groupe WhatsApp dédié au contrôle qualité. Je serai le seul administrateur et je pourrai envoyer des sondages afin de recueillir vos avis.',
    en: 'If you provide your phone number, it will be manually added to a WhatsApp group dedicated to quality feedback. I will be the only administrator and may send surveys to collect your opinions.'
  },
  'signup.whatsapp.consent': { fr: "J'accepte d'être ajouté au groupe WhatsApp.", en: 'I agree to be added to the WhatsApp group.' },
  'signup.email.consent': { fr: "J'accepte de recevoir la newsletter par email.", en: 'I agree to receive the newsletter by email.' },
  'signup.error.email.exists': { fr: 'Cet email est déjà inscrit.', en: 'This email is already registered.' },
  'signup.error.generic': { fr: 'Une erreur est survenue. Veuillez réessayer.', en: 'An error occurred. Please try again.' },
  
  // Confirmation page
  'confirm.title': { fr: 'Inscription confirmée', en: 'Registration confirmed' },
  'confirm.thanks': { fr: 'Merci pour votre inscription !', en: 'Thank you for signing up!' },
  'confirm.summary': { fr: 'Récapitulatif', en: 'Summary' },
  'confirm.language': { fr: 'Langue', en: 'Language' },
  'confirm.topics': { fr: 'Sujets sélectionnés', en: 'Selected topics' },
  'confirm.email': { fr: 'Email', en: 'Email' },
  'confirm.whatsapp': { fr: 'Groupe WhatsApp', en: 'WhatsApp group' },
  'confirm.whatsapp.yes': { fr: 'Oui', en: 'Yes' },
  'confirm.whatsapp.no': { fr: 'Non', en: 'No' },
  'confirm.edit': { fr: 'Modifier mes préférences', en: 'Edit my preferences' },
  
  // Progress
  'progress.step': { fr: 'Étape', en: 'Step' },
  'progress.of': { fr: 'sur', en: 'of' },
  
  // Summary sidebar
  'summary.title': { fr: 'Vos choix', en: 'Your choices' },
  'summary.language': { fr: 'Langue', en: 'Language' },
  'summary.topics': { fr: 'Sujets', en: 'Topics' },
  'summary.none': { fr: 'Aucun', en: 'None' },
  
  // Language names
  'language.fr': { fr: 'Français', en: 'French' },
  'language.en': { fr: 'Anglais', en: 'English' },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(null);

  const t = (key: string): string => {
    const translation = translations[key];
    if (!translation) return key;
    if (!language) return translation['en'] || key;
    return translation[language] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
