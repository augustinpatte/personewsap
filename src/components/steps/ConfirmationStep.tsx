import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWizard } from '@/contexts/WizardContext';
import { Button } from '@/components/ui/button';
import WizardLayout from '@/components/WizardLayout';
import { CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ConfirmationStepProps {
  onEdit: () => void;
  totalSteps: number;
}

const ConfirmationStep = ({ onEdit, totalSteps }: ConfirmationStepProps) => {
  const { language, t } = useLanguage();
  const { userData, topicPreferences } = useWizard();
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authId, setAuthId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      setAuthEmail(data.session?.user?.email ?? null);
      setAuthId(data.session?.user?.id ?? null);
    };
    load();
  }, []);

  return (
    <WizardLayout currentStep={totalSteps} totalSteps={totalSteps} showSidebar={false}>
      <div className="max-w-lg mx-auto animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 mb-4">
            <CheckCircle className="w-8 h-8 text-success" />
          </div>
          <h1 className="font-serif text-2xl md:text-3xl font-semibold text-foreground mb-2">
            {t('confirm.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('confirm.thanks')}
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 mb-8">
          <h2 className="font-serif font-semibold text-lg text-foreground mb-4">
            {t('confirm.summary')}
          </h2>

          <div className="space-y-4 text-sm">
            <div className="flex justify-between pb-3 border-b border-border">
              <span className="text-muted-foreground">{t('confirm.language')}</span>
              <span className="font-medium text-foreground">
                {language === 'fr' ? t('language.fr') : t('language.en')}
              </span>
            </div>

            <div className="pb-3 border-b border-border">
              <span className="text-muted-foreground">{t('confirm.topics')}</span>
              <ul className="mt-2 space-y-1">
                {topicPreferences.map((pref) => (
                  <li key={pref.topicKey} className="flex justify-between text-foreground">
                    <span>{t(`topics.${pref.topicKey}`)}</span>
                    <span className="text-accent font-medium">
                      ×{pref.articlesCount}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex justify-between pb-3 border-b border-border">
              <span className="text-muted-foreground">{t('confirm.email')}</span>
              <span className="font-medium text-foreground">{userData.email}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('confirm.whatsapp')}</span>
              <span className="font-medium text-foreground">
                {userData.whatsappOptIn ? t('confirm.whatsapp.yes') : t('confirm.whatsapp.no')}
              </span>
            </div>

            {(authEmail || authId) && (
              <div className="pt-3 border-t border-border text-xs text-muted-foreground">
                {authEmail && <div>Auth email: {authEmail}</div>}
                {authId && <div>Auth user id: {authId}</div>}
              </div>
            )}
          </div>
        </div>

        <Button
          variant="outline"
          onClick={onEdit}
          className="w-full py-6"
          size="lg"
        >
          {t('confirm.edit')}
        </Button>
      </div>
    </WizardLayout>
  );
};

export default ConfirmationStep;
