import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWizard } from '@/contexts/WizardContext';
import { Button } from '@/components/ui/button';
import WizardLayout from '@/components/WizardLayout';
import { loadPendingRegistration, clearPendingRegistration } from '@/lib/pendingRegistration';
import { resendSignupEmail, sendPasswordResetEmail, completeRegistration } from '@/lib/registration';
import { supabase } from '@/integrations/supabase/client';

interface VerificationStepProps {
  onNext: () => void;
  onBack: () => void;
  totalSteps: number;
  currentStep: number;
}

const VerificationStep = ({ onNext, onBack, totalSteps, currentStep }: VerificationStepProps) => {
  const { t } = useLanguage();
  const { setRegisteredUserId } = useWizard();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = typeof window !== 'undefined' ? loadPendingRegistration() : null;

  const handleResend = async () => {
    if (!pending) {
      setError(t('verify.missing'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { error: resendError } = await resendSignupEmail(pending.user.email);
    if (resendError) {
      const { error: resetError } = await sendPasswordResetEmail(pending.user.email);
      if (resetError) {
        setError(t('signup.error.generic'));
      }
    }

    setIsSubmitting(false);
  };

  const handleVerify = async () => {
    if (!pending) {
      setError(t('verify.missing'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      setError(t('verify.no_session'));
      setIsSubmitting(false);
      return;
    }

    try {
      const userId = await completeRegistration(pending, data.session.user);
      setRegisteredUserId(userId);
      clearPendingRegistration();
      onNext();
    } catch (err) {
      setError(t('signup.error.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <WizardLayout currentStep={currentStep} totalSteps={totalSteps} showSidebar={false}>
      <div className="max-w-lg mx-auto animate-fade-in text-center">
        <h1 className="font-serif text-2xl md:text-3xl font-semibold text-foreground mb-3">
          {t('verify.title')}
        </h1>
        <p className="text-muted-foreground mb-6">
          {t('verify.subtitle')}
        </p>

        {pending?.user?.email && (
          <div className="mb-6 text-sm text-foreground">
            <span className="text-muted-foreground">{t('verify.email.sent')} </span>
            <span className="font-medium">{pending.user.email}</span>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Button
            onClick={handleVerify}
            className="w-full py-6"
            size="lg"
            disabled={isSubmitting}
          >
            {isSubmitting ? t('verify.processing') : t('verify.confirm')}
          </Button>
          <Button
            variant="outline"
            onClick={handleResend}
            className="w-full py-6"
            size="lg"
            disabled={isSubmitting}
          >
            {t('verify.resend')}
          </Button>
          <Button
            variant="ghost"
            onClick={onBack}
            className="w-full py-6"
            size="lg"
            disabled={isSubmitting}
          >
            {t('verify.edit')}
          </Button>
        </div>
      </div>
    </WizardLayout>
  );
};

export default VerificationStep;
