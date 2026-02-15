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
      <div className="max-w-md mx-auto animate-fade-in text-center mt-12 md:mt-16">
        <h1 className="font-serif text-4xl md:text-5xl font-semibold text-foreground mb-4">
          Bienvenue / Welcome
        </h1>
        <p className="text-base md:text-lg text-muted-foreground mb-12">
          Inscrivez-vous ou connectez-vous pour gérer votre newsletter. / Sign in to manage your newsletter.
        </p>
        <div className="space-y-4 mt-12">
          <Button
            onClick={onSubscribe}
            className="w-full py-6 text-base font-medium bg-[#054EAB] text-white hover:bg-[#054EAB]/90"
          >
            S'inscrire / Subscribe
          </Button>
          <Button onClick={onLogin} variant="outline" className="w-full py-6 text-base font-medium">
            Login
          </Button>
        </div>
      </div>
    </WizardLayout>
  );
};

export default EntryStep;
