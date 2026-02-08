import { useMemo, useState } from 'react';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWizard } from '@/contexts/WizardContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import WizardLayout from '@/components/WizardLayout';
import { getCountryOptions } from '@/lib/countries';
import { savePendingRegistration, clearPendingRegistration } from '@/lib/pendingRegistration';
import { signUpWithPassword, completeRegistration } from '@/lib/registration';
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
  const { userData, setUserData, topicPreferences } = useWizard();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const emailSchema = z.string().trim().email().max(255);
  const nameSchema = z.string().trim().min(1).max(100);
  const phoneSchema = z.string().trim().max(30).optional();
  const passwordSchema = z.string().min(8).max(128);

  const countryOptions = useMemo(
    () => getCountryOptions(language === 'fr' ? 'fr' : 'en'),
    [language]
  );

  const validateForm = (): { valid: boolean; phoneE164: string | null } => {
    const errors: Record<string, string> = {};

    if (!nameSchema.safeParse(userData.firstName).success) {
      errors.firstName = t('signup.error.first_name');
    }
    if (!nameSchema.safeParse(userData.lastName).success) {
      errors.lastName = t('signup.error.last_name');
    }
    if (!emailSchema.safeParse(userData.email).success) {
      errors.email = t('signup.error.email.invalid');
    }
    if (!passwordSchema.safeParse(password).success) {
      errors.password = t('signup.error.password.invalid');
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = t('signup.error.password.match');
    }
    if (!userData.emailOptIn) {
      errors.emailOptIn = t('signup.error.email.optin');
    }
    if (userData.phoneNumber && !userData.phoneCountry) {
      errors.phoneCountry = t('signup.error.phone.country');
    }

    let phoneE164: string | null = null;
    if (userData.phoneNumber) {
      if (!phoneSchema.safeParse(userData.phoneNumber).success) {
        errors.phoneNumber = t('signup.error.phone.invalid');
      } else if (userData.phoneCountry) {
        const parsed = parsePhoneNumberFromString(userData.phoneNumber, userData.phoneCountry as any);
        if (!parsed || !parsed.isValid()) {
          errors.phoneNumber = t('signup.error.phone.invalid');
        } else {
          phoneE164 = parsed.number;
        }
      }
    }

    if (userData.phoneNumber && !userData.whatsappOptIn) {
      errors.whatsappOptIn = t('signup.error.whatsapp.optin');
    }

    setFieldErrors(errors);
    return { valid: Object.keys(errors).length === 0, phoneE164 };
  };

  const handleSubmit = async () => {
    const { valid, phoneE164 } = validateForm();
    if (!valid) return;

    setIsSubmitting(true);
    setError(null);

    const pending = {
      language,
      user: {
        firstName: userData.firstName.trim(),
        lastName: userData.lastName.trim(),
        email: userData.email.trim().toLowerCase(),
        phone: phoneE164,
        whatsappOptIn: userData.whatsappOptIn,
        emailOptIn: userData.emailOptIn,
      },
      topics: topicPreferences,
      createdAt: new Date().toISOString(),
    };

    try {
      clearPendingRegistration();
      const { error: authError } = await signUpWithPassword(pending.user.email, password);

      if (authError) {
        setError(`${t('signup.error.generic')} (${authError.message})`);
        setIsSubmitting(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: pending.user.email,
        password,
      });

      if (signInError) {
        setError(`${t('signup.error.generic')} (${signInError.message})`);
        setIsSubmitting(false);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.user) {
        setError(t('signup.error.generic'));
        setIsSubmitting(false);
        return;
      }

      await completeRegistration(pending, sessionData.session.user);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('signup.error.generic'));
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

  const updatePasswordField = (field: 'password' | 'confirmPassword', value: string) => {
    if (field === 'password') {
      setPassword(value);
    } else {
      setConfirmPassword(value);
    }
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

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="password" className="text-foreground">
                {t('signup.password')} *
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => updatePasswordField('password', e.target.value)}
                className={`mt-1 ${fieldErrors.password ? 'border-destructive' : ''}`}
                maxLength={128}
              />
              {fieldErrors.password && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.password}</p>
              )}
            </div>
            <div>
              <Label htmlFor="confirmPassword" className="text-foreground">
                {t('signup.password.confirm')} *
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => updatePasswordField('confirmPassword', e.target.value)}
                className={`mt-1 ${fieldErrors.confirmPassword ? 'border-destructive' : ''}`}
                maxLength={128}
              />
              {fieldErrors.confirmPassword && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.confirmPassword}</p>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-[1.2fr_2fr] gap-4">
            <div>
              <Label htmlFor="phoneCountry" className="text-foreground">
                {t('signup.phone.country')}
              </Label>
              <select
                id="phoneCountry"
                value={userData.phoneCountry}
                onChange={(e) => updateField('phoneCountry', e.target.value)}
                className={`mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  fieldErrors.phoneCountry ? 'border-destructive' : ''
                }`}
              >
                <option value="">{t('signup.phone.country.placeholder')}</option>
                {countryOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
              {fieldErrors.phoneCountry && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.phoneCountry}</p>
              )}
            </div>
            <div>
              <Label htmlFor="phone" className="text-foreground">
                {t('signup.phone')} <span className="text-muted-foreground">{t('signup.phone.optional')}</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                value={userData.phoneNumber}
                onChange={(e) => updateField('phoneNumber', e.target.value)}
                className={`mt-1 ${fieldErrors.phoneNumber ? 'border-destructive' : ''}`}
                maxLength={30}
              />
              {fieldErrors.phoneNumber && (
                <p className="text-sm text-destructive mt-1">{fieldErrors.phoneNumber}</p>
              )}
            </div>
          </div>

          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {t('signup.phone.notice')}
          </p>

          {userData.phoneNumber && (
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
