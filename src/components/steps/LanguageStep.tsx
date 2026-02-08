import { useState } from 'react';
import { useLanguage, Language } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import WizardLayout from '@/components/WizardLayout';

interface LanguageStepProps {
  onNext: () => void;
}

const LanguageStep = ({ onNext }: LanguageStepProps) => {
  const { language, setLanguage, t } = useLanguage();
  const [selected, setSelected] = useState<Language>(language);

  const handleSelect = (lang: Language) => {
    setSelected(lang);
    setLanguage(lang);
  };

  const handleContinue = () => {
    if (selected) {
      onNext();
    }
  };

  return (
    <WizardLayout currentStep={1} totalSteps={4} showSidebar={false} showProgress={false}>
      <div className="max-w-md mx-auto animate-fade-in">
        <div className="text-center mb-12">
          <h1 className="font-serif text-3xl md:text-4xl font-semibold text-foreground mb-4">
            {t('lang.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('lang.subtitle')}
          </p>
        </div>

        <div className="space-y-4 mb-8">
          <button
            onClick={() => handleSelect('fr')}
            className={`w-full p-5 rounded-lg border-2 transition-all duration-200 text-left ${
              selected === 'fr'
                ? 'border-selection-border bg-selection-bg'
                : 'border-border bg-card hover:border-muted-foreground/30'
            }`}
          >
            <div className="flex items-center gap-4">
              <span className="text-2xl">🇫🇷</span>
              <div>
                <div className="font-medium text-foreground">{t('language.fr')}</div>
                <div className="text-sm text-muted-foreground">French</div>
              </div>
            </div>
          </button>

          <button
            onClick={() => handleSelect('en')}
            className={`w-full p-5 rounded-lg border-2 transition-all duration-200 text-left ${
              selected === 'en'
                ? 'border-selection-border bg-selection-bg'
                : 'border-border bg-card hover:border-muted-foreground/30'
            }`}
          >
            <div className="flex items-center gap-4">
              <span className="text-2xl">🇬🇧</span>
              <div>
                <div className="font-medium text-foreground">English</div>
                <div className="text-sm text-muted-foreground">{t('language.en')}</div>
              </div>
            </div>
          </button>
        </div>

        <Button
          onClick={handleContinue}
          disabled={!selected}
          className="w-full py-6 text-base font-medium"
          size="lg"
        >
          {t('nav.continue')}
        </Button>
      </div>
    </WizardLayout>
  );
};

export default LanguageStep;
