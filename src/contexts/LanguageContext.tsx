import React, { createContext, useContext, useMemo, useState, ReactNode } from 'react';

export type Language = 'fr' | 'en' | null;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const STORAGE_KEY = 'preferredLanguage';

const translations: Record<string, Record<string, string>> = {
  // Navigation
  'nav.back': { fr: 'Retour', en: 'Back' },
  'nav.continue': { fr: 'Continuer', en: 'Continue' },
  'nav.signup': { fr: "S'inscrire", en: 'Sign up' },
  'nav.verify': { fr: 'Vérifier', en: 'Verify' },
  'nav.resend': { fr: 'Renvoyer', en: 'Resend' },
  'nav.unsubscribe': { fr: 'Se désinscrire', en: 'Unsubscribe' },

  // Language selection page
  'lang.title': { fr: 'Choisissez votre langue', en: 'Choose your language' },
  'lang.subtitle': { fr: "Cette langue sera utilisée pour toute l'interface", en: 'This language will be used for the entire interface' },

  // Entry page
  'entry.title': { fr: 'Bienvenue', en: 'Welcome' },
  'entry.subtitle': { fr: 'Connectez-vous ou créez votre abonnement.', en: 'Sign in or create your subscription.' },
  'entry.subscribe': { fr: "S'abonner", en: 'Subscribe' },
  'entry.login': { fr: 'Se connecter', en: 'Login' },

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
  'articles.title': { fr: "Nombre d'articles par sujet", en: 'Number of articles per topic' },
  'articles.subtitle': { fr: "Définissez combien d'articles vous souhaitez recevoir", en: 'Define how many articles you want to receive' },
  'articles.count': { fr: 'articles', en: 'articles' },
  'articles.article': { fr: 'article', en: 'article' },

  // Signup page
  'signup.title': { fr: 'Inscription', en: 'Sign Up' },
  'signup.subtitle': { fr: 'Finalisez votre inscription à la newsletter', en: 'Complete your newsletter subscription' },
  'signup.firstname': { fr: 'Prénom', en: 'First name' },
  'signup.lastname': { fr: 'Nom', en: 'Last name' },
  'signup.email': { fr: 'Email', en: 'Email' },
  'signup.password': { fr: 'Mot de passe', en: 'Password' },
  'signup.password.confirm': { fr: 'Confirmer le mot de passe', en: 'Confirm password' },
  'signup.phone.country': { fr: 'Pays du numéro', en: 'Phone country' },
  'signup.phone.country.placeholder': { fr: 'Sélectionner un pays', en: 'Select a country' },
  'signup.phone': { fr: 'Numéro de téléphone', en: 'Phone number' },
  'signup.phone.optional': { fr: '(optionnel)', en: '(optional)' },
  'signup.phone.notice': {
    fr: "Si vous renseignez votre numéro, vous serez ajouté manuellement à un groupe WhatsApp dédié au contrôle qualité. Je serai le seul administrateur et je pourrai envoyer des sondages afin de recueillir vos avis.",
    en: 'If you provide your phone number, it will be manually added to a WhatsApp group dedicated to quality feedback. I will be the only administrator and may send surveys to collect your opinions.'
  },
  'signup.whatsapp.consent': { fr: "J'accepte d'être ajouté au groupe WhatsApp.", en: 'I agree to be added to the WhatsApp group.' },
  'signup.email.consent': { fr: "J'accepte de recevoir la newsletter par email.", en: 'I agree to receive the newsletter by email.' },
  'signup.error.email.exists': { fr: "Cet email est déjà inscrit.", en: 'This email is already registered.' },
  'signup.error.generic': { fr: 'Une erreur est survenue. Veuillez réessayer.', en: 'An error occurred. Please try again.' },
  'signup.error.first_name': { fr: 'Prénom requis', en: 'First name required' },
  'signup.error.last_name': { fr: 'Nom requis', en: 'Last name required' },
  'signup.error.email.invalid': { fr: 'Email invalide', en: 'Invalid email' },
  'signup.error.email.optin': { fr: 'Vous devez accepter de recevoir la newsletter', en: 'You must agree to receive the newsletter' },
  'signup.error.whatsapp.optin': { fr: 'Vous devez accepter pour ajouter votre numéro', en: 'You must agree to add your phone number' },
  'signup.error.phone.country': { fr: 'Sélectionnez un pays', en: 'Select a country' },
  'signup.error.phone.invalid': { fr: 'Numéro invalide', en: 'Invalid phone number' },
  'signup.error.password.invalid': { fr: 'Mot de passe trop court (8 caractères min.)', en: 'Password too short (min 8 chars)' },
  'signup.error.password.match': { fr: 'Les mots de passe ne correspondent pas', en: 'Passwords do not match' },

  // Verification page
  'verify.title': { fr: 'Vérifiez votre email', en: 'Verify your email' },
  'verify.subtitle': {
    fr: "Nous avons envoyé un lien de vérification à votre adresse email. Ouvrez-le pour terminer l'inscription.",
    en: 'We sent a verification link to your email address. Open it to complete the registration.'
  },
  'verify.email.sent': { fr: 'Email envoyé à', en: 'Email sent to' },
  'verify.resend': { fr: "Renvoyer l'email", en: 'Resend email' },
  'verify.confirm': { fr: "J'ai vérifié mon email", en: "I've verified my email" },
  'verify.edit': { fr: 'Modifier mon email', en: 'Edit my email' },
  'verify.missing': { fr: 'Aucune inscription en attente trouvée.', en: 'No pending registration found.' },
  'verify.processing': { fr: 'Finalisation en cours...', en: 'Finishing registration...' },
  'verify.completed': { fr: 'Inscription finalisée.', en: 'Registration completed.' },
  'verify.no_session': {
    fr: "Cliquez sur le lien reçu par email, puis revenez ici pour terminer.",
    en: 'Open the email link, then come back here to finish.'
  },

  // Login
  'login.title': { fr: 'Connexion', en: 'Login' },
  'login.subtitle': { fr: 'Accédez à vos préférences', en: 'Access your preferences' },
  'login.email': { fr: 'Email', en: 'Email' },
  'login.password': { fr: 'Mot de passe', en: 'Password' },
  'login.submit': { fr: 'Se connecter', en: 'Sign in' },
  'login.error': { fr: 'Email ou mot de passe invalide.', en: 'Invalid email or password.' },
  'login.forgot': { fr: 'Mot de passe oublié ?', en: 'Forgot password?' },

  // Account
  'account.title': { fr: 'Vos préférences', en: 'Your preferences' },
  'account.subtitle': { fr: 'Consultez et mettez à jour vos choix.', en: 'Review and update your choices.' },
  'account.section.profile': { fr: 'Profil', en: 'Profile' },
  'account.section.topics': { fr: 'Sujets', en: 'Topics' },
  'account.section.password': { fr: 'Mot de passe', en: 'Password' },
  'account.language': { fr: 'Langue', en: 'Language' },
  'account.save': { fr: 'Enregistrer', en: 'Save' },
  'account.saved': { fr: 'Modifications enregistrées.', en: 'Changes saved.' },
  'account.signout': { fr: 'Se déconnecter', en: 'Sign out' },
  'account.unsubscribe': { fr: 'Se désinscrire de la newsletter', en: 'Unsubscribe from the newsletter' },
  'account.unsubscribe.confirm': { fr: 'Votre abonnement a été supprimé.', en: 'Your subscription has been removed.' },
  'account.password.new': { fr: 'Nouveau mot de passe', en: 'New password' },
  'account.password.confirm': { fr: 'Confirmer le mot de passe', en: 'Confirm password' },
  'account.password.update': { fr: 'Mettre à jour le mot de passe', en: 'Update password' },
  'account.password.success': { fr: 'Mot de passe mis à jour.', en: 'Password updated.' },
  'account.error': { fr: 'Impossible de charger vos données.', en: 'Could not load your data.' },

  // Feedback page
  'feedback.title': { fr: 'Votre avis compte', en: 'Your feedback matters' },
  'feedback.subtitle': { fr: 'Notez cette newsletter en un clic', en: 'Rate this newsletter in one click' },
  'feedback.email': { fr: 'Email', en: 'Email' },
  'feedback.issue': { fr: 'Date de la newsletter', en: 'Newsletter date' },
  'feedback.rating': { fr: 'Votre note', en: 'Your rating' },
  'feedback.good': { fr: 'Bien', en: 'Good' },
  'feedback.average': { fr: 'Moyen', en: 'Average' },
  'feedback.bad': { fr: 'Mauvais', en: 'Bad' },
  'feedback.message': { fr: 'Commentaire (optionnel)', en: 'Comment (optional)' },
  'feedback.submit': { fr: 'Envoyer', en: 'Send' },
  'feedback.thanks': { fr: 'Merci pour votre retour !', en: 'Thanks for your feedback!' },
  'feedback.error': { fr: "Impossible d'envoyer votre retour.", en: 'Could not submit your feedback.' },

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

const getInitialLanguage = (): Language => {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'fr' || stored === 'en') return stored;
  const browser = window.navigator.language?.toLowerCase() ?? '';
  if (browser.startsWith('fr')) return 'fr';
  if (browser.startsWith('en')) return 'en';
  return null;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => getInitialLanguage());

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window === 'undefined') return;
    if (lang) {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const t = useMemo(() => {
    return (key: string): string => {
      const translation = translations[key];
      if (!translation) return key;
      if (!language) return translation.en || key;
      return translation[language] || key;
    };
  }, [language]);

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
