import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWizard } from '@/contexts/WizardContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import WizardLayout from '@/components/WizardLayout';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';

interface SignupStepProps {
  onNext: () => void;
  onBack: () => void;
  totalSteps: number;
  currentStep: number;
}

const SignupStep = ({ onNext, onBack, totalSteps, currentStep }: SignupStepProps) => {
  const { language, t } = useLanguage();
  const { userData, setUserData, selectedTopics, topicPreferences, setRegisteredUserId } = useWizard();
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const emailSchema = z.string().trim().email().max(255);
  const nameSchema = z.string().trim().min(1).max(100);
  const phoneSchema = z.string().max(20).optional();

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    
    if (!nameSchema.safeParse(userData.firstName).success) {
      errors.firstName = language === 'fr' ? 'Prénom requis' : 'First name required';
    }
    if (!nameSchema.safeParse(userData.lastName).success) {
      errors.lastName = language === 'fr' ? 'Nom requis' : 'Last name required';
    }
    if (!emailSchema.safeParse(userData.email).success) {
      errors.email = language === 'fr' ? 'Email invalide' : 'Invalid email';
    }
    if (!userData.emailOptIn) {
      errors.emailOptIn = language === 'fr' ? 'Vous devez accepter de recevoir la newsletter' : 'You must agree to receive the newsletter';
    }
    if (userData.phone && !userData.whatsappOptIn) {
      errors.whatsappOptIn = language === 'fr' ? 'Vous devez accepter pour ajouter votre numéro' : 'You must agree to add your phone number';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Insert user
      const { data: user, error: userError } = await supabase
        .from('users')
        .insert({
          language: language,
          first_name: userData.firstName.trim(),
          last_name: userData.lastName.trim(),
          email: userData.email.trim().toLowerCase(),
          phone: userData.phone?.trim() || null,
          whatsapp_opt_in: userData.whatsappOptIn,
          email_opt_in: userData.emailOptIn,
        })
        .select('id')
        .single();

      if (userError) {
        if (userError.code === '23505') { // Unique constraint violation
          setError(t('signup.error.email.exists'));
        } else {
          setError(t('signup.error.generic'));
        }
        setIsSubmitting(false);
        return;
      }

      // Insert topic preferences
      const topicInserts = topicPreferences.map(pref => ({
        user_id: user.id,
        topic_name: pref.topicKey,
        articles_count: pref.articlesCount,
      }));

      const { error: topicsError } = await supabase
        .from('user_topics')
        .insert(topicInserts);

      if (topicsError) {
        setError(t('signup.error.generic'));
        setIsSubmitting(false);
        return;
      }

      setRegisteredUserId(user.id);
      onNext();
    } catch (err) {
      setError(t('signup.error.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: keyof typeof userData, value: string | boolean) => {
    setUserData({ ...userData, [field]: value });
    if (fieldErrors[field]) {
      setFieldErrors({ ...fieldErrors, [field]: '' });
    }
  };

  return (
    <WizardLayout currentStep={currentStep} totalSteps={totalSteps}>
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="font-serif text-2xl md:text-3xl font-semibold text-foreground mb-2">
            {t('signup.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('signup.subtitle')}
          </p>
        </div>

        <div className="space-y-5 mb-8">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName" className="text-foreground">
                {t('signup.firstname')} *
              </Label>
              <Input
                id="firstName"
                value={userData.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
                className={`mt-1 ${fieldErrors.firstName ? 'border-destructive' : ''}`}
                maxLength={100}
              />
              {fieldErrors.firstName && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.firstName}</p>
              )}
            </div>
            <div>
              <Label htmlFor="lastName" className="text-foreground">
                {t('signup.lastname')} *
              </Label>
              <Input
                id="lastName"
                value={userData.lastName}
                onChange={(e) => updateField('lastName', e.target.value)}
                className={`mt-1 ${fieldErrors.lastName ? 'border-destructive' : ''}`}
                maxLength={100}
              />
              {fieldErrors.lastName && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.lastName}</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="email" className="text-foreground">
              {t('signup.email')} *
            </Label>
            <Input
              id="email"
              type="email"
              value={userData.email}
              onChange={(e) => updateField('email', e.target.value)}
              className={`mt-1 ${fieldErrors.email ? 'border-destructive' : ''}`}
              maxLength={255}
            />
            {fieldErrors.email && (
              <p className="text-sm text-destructive mt-1">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <Label htmlFor="phone" className="text-foreground">
              {t('signup.phone')} <span className="text-muted-foreground">{t('signup.phone.optional')}</span>
            </Label>
            <Input
              id="phone"
              type="tel"
              value={userData.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              className="mt-1"
              maxLength={20}
            />
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {t('signup.phone.notice')}
            </p>
          </div>

          {userData.phone && (
            <div className="flex items-start gap-3 p-4 bg-secondary rounded-lg">
              <Checkbox
                id="whatsappOptIn"
                checked={userData.whatsappOptIn}
                onCheckedChange={(checked) => updateField('whatsappOptIn', checked as boolean)}
                className="mt-0.5"
              />
              <Label htmlFor="whatsappOptIn" className="text-foreground cursor-pointer leading-relaxed">
                {t('signup.whatsapp.consent')}
              </Label>
            </div>
          )}
          {fieldErrors.whatsappOptIn && (
            <p className="text-sm text-destructive">{fieldErrors.whatsappOptIn}</p>
          )}

          <div className="flex items-start gap-3 p-4 bg-secondary rounded-lg">
            <Checkbox
              id="emailOptIn"
              checked={userData.emailOptIn}
              onCheckedChange={(checked) => updateField('emailOptIn', checked as boolean)}
              className="mt-0.5"
            />
            <Label htmlFor="emailOptIn" className="text-foreground cursor-pointer leading-relaxed">
              {t('signup.email.consent')} *
            </Label>
          </div>
          {fieldErrors.emailOptIn && (
            <p className="text-sm text-destructive">{fieldErrors.emailOptIn}</p>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={onBack}
            className="flex-1 py-6"
            size="lg"
            disabled={isSubmitting}
          >
            {t('nav.back')}
          </Button>
          <Button
            onClick={handleSubmit}
            className="flex-1 py-6"
            size="lg"
            disabled={isSubmitting}
          >
            {isSubmitting ? '...' : t('nav.signup')}
          </Button>
        </div>
      </div>
    </WizardLayout>
  );
};

export default SignupStep;
