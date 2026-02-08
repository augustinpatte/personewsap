import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import WizardLayout from '@/components/WizardLayout';

interface EntryStepProps {
  onSubscribe: () => void;
  onLogin: () => void;
}

const EntryStep = ({ onSubscribe, onLogin }: EntryStepProps) => {
  const { t } = useLanguage();

  return (
    <WizardLayout currentStep={1} totalSteps={1} showSidebar={false} showProgress={false}>
      <div className="max-w-md mx-auto animate-fade-in text-center">
        <h1 className="font-serif text-3xl md:text-4xl font-semibold text-foreground mb-4">
          {t('entry.title')} / Welcome
        </h1>
        <p className="text-muted-foreground mb-10">
          {t('entry.subtitle')} / Sign in or create your subscription.
        </p>
        <div className="space-y-4">
          <Button onClick={onSubscribe} className="w-full py-6 text-base font-medium">
            {t('entry.subscribe')} / Subscribe
          </Button>
          <Button onClick={onLogin} variant="outline" className="w-full py-6 text-base font-medium">
            {t('entry.login')} / Login
          </Button>
        </div>
      </div>
    </WizardLayout>
  );
};

export default EntryStep;
