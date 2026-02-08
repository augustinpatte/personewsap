import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { getCountryOptions } from '@/lib/countries';
import BrandHeader from '@/components/BrandHeader';

type TopicPreference = {
  topicKey: string;
  articlesCount: number;
};

const TOPIC_KEYS = [
  'sport',
  'international',
  'finance',
  'stocks',
  'automotive',
  'pharma',
  'ai',
  'culture',
];

const Account = () => {
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [languageValue, setLanguageValue] = useState<'fr' | 'en'>('en');
  const [phoneCountry, setPhoneCountry] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(true);
  const [topicPreferences, setTopicPreferences] = useState<TopicPreference[]>([]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [unsubscribeMessage, setUnsubscribeMessage] = useState<string | null>(null);

  const countryOptions = useMemo(
    () => getCountryOptions(language === 'fr' ? 'fr' : 'en'),
    [language]
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const authUser = sessionData.session?.user;
      if (!authUser) {
        navigate('/login');
        return;
      }

      setEmail(authUser.email ?? '');

      const { data: userRow, error: userError } = await supabase
        .from('users')
        .select('id, first_name, last_name, language, phone, whatsapp_opt_in, email_opt_in')
        .eq('auth_user_id', authUser.id)
        .single();

      if (userError || !userRow) {
        setError(t('account.error'));
        setLoading(false);
        return;
      }

      setFirstName(userRow.first_name ?? '');
      setLastName(userRow.last_name ?? '');
      setLanguageValue(userRow.language === 'fr' ? 'fr' : 'en');
      setWhatsappOptIn(!!userRow.whatsapp_opt_in);
      setEmailOptIn(!!userRow.email_opt_in);

      if (userRow.phone) {
        const parsed = parsePhoneNumberFromString(userRow.phone);
        if (parsed) {
          setPhoneCountry(parsed.country || '');
          setPhoneNumber(parsed.nationalNumber || '');
        } else {
          setPhoneNumber(userRow.phone);
        }
      }

      const { data: topics } = await supabase
        .from('user_topics')
        .select('topic_name, articles_count')
        .eq('user_id', userRow.id);

      if (topics) {
        const mapped = topics.map((topic) => ({
          topicKey: topic.topic_name,
          articlesCount: topic.articles_count,
        }));
        setTopicPreferences(mapped);
      }

      setLanguage(userRow.language === 'fr' ? 'fr' : 'en');
      setLoading(false);
    };

    load();
  }, [navigate, setLanguage, t]);

  const updateTopic = (topicKey: string, enabled: boolean, count = 1) => {
    setTopicPreferences((prev) => {
      const exists = prev.find((topic) => topic.topicKey === topicKey);
      if (enabled && !exists) {
        return [...prev, { topicKey, articlesCount: count }];
      }
      if (!enabled && exists) {
        return prev.filter((topic) => topic.topicKey !== topicKey);
      }
      return prev;
    });
  };

  const updateTopicCount = (topicKey: string, count: number) => {
    setTopicPreferences((prev) =>
      prev.map((topic) =>
        topic.topicKey === topicKey ? { ...topic, articlesCount: count } : topic
      )
    );
  };

  const handleSave = async () => {
    setSaved(false);
    setUnsubscribeMessage(null);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const authUser = sessionData.session?.user;
    if (!authUser) {
      navigate('/login');
      return;
    }

    const normalizedPhone = phoneNumber
      ? parsePhoneNumberFromString(phoneNumber, phoneCountry as any)?.number ?? phoneNumber
      : null;

    const { error: updateError } = await supabase
      .from('users')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        language: languageValue,
        phone: normalizedPhone,
        whatsapp_opt_in: whatsappOptIn,
        email_opt_in: emailOptIn,
      })
      .eq('auth_user_id', authUser.id);

    if (updateError) {
      setError(t('signup.error.generic'));
      return;
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', authUser.id)
      .single();

    if (!userRow) {
      setError(t('signup.error.generic'));
      return;
    }

    const topicRows = topicPreferences.map((topic) => ({
      user_id: userRow.id,
      topic_name: topic.topicKey,
      articles_count: topic.articlesCount,
    }));

    const { error: topicsError } = await supabase
      .from('user_topics')
      .upsert(topicRows, { onConflict: 'user_id,topic_name' });

    if (topicsError) {
      setError(t('signup.error.generic'));
      return;
    }

    const toRemove = TOPIC_KEYS.filter(
      (topic) => !topicPreferences.find((pref) => pref.topicKey === topic)
    );
    if (toRemove.length > 0) {
      await supabase
        .from('user_topics')
        .delete()
        .eq('user_id', userRow.id)
        .in('topic_name', toRemove);
    }

    setLanguage(languageValue);
    setSaved(true);
  };

  const handlePasswordUpdate = async () => {
    setPasswordMessage(null);
    if (!password || password.length < 8 || password !== confirmPassword) {
      setPasswordMessage(t('signup.error.password.match'));
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setPasswordMessage(t('signup.error.generic'));
      return;
    }

    setPassword('');
    setConfirmPassword('');
    setPasswordMessage(t('account.password.success'));
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const handleUnsubscribe = async () => {
    setUnsubscribeMessage(null);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const authUser = sessionData.session?.user;
    if (!authUser) {
      navigate('/login');
      return;
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', authUser.id)
      .single();

    if (userRow?.id) {
      // Mark as opted-out and clear topics. Keep profile to ensure dispatch skips.
      await supabase
        .from('users')
        .update({ email_opt_in: false })
        .eq('id', userRow.id);

      await supabase
        .from('user_topics')
        .delete()
        .eq('user_id', userRow.id);
    }

    setUnsubscribeMessage(t('account.unsubscribe.confirm'));
    await supabase.auth.signOut();
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-muted-foreground">{t('verify.processing')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-14 space-y-8">
        <BrandHeader />
        <div>
          <h1 className="font-serif text-3xl md:text-4xl font-semibold mb-2">
            {t('account.title')}
          </h1>
          <p className="text-muted-foreground">{t('account.subtitle')}</p>
        </div>

        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        {saved && (
          <div className="p-4 bg-success/10 border border-success/20 rounded-lg">
            <p className="text-success text-sm">{t('account.saved')}</p>
          </div>
        )}

        {unsubscribeMessage && (
          <div className="p-4 bg-success/10 border border-success/20 rounded-lg">
            <p className="text-success text-sm">{unsubscribeMessage}</p>
          </div>
        )}

        <div className="bg-card border border-border rounded-lg p-6 space-y-5">
          <h2 className="font-serif font-semibold text-lg">{t('account.section.profile')}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">{t('signup.firstname')}</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="lastName">{t('signup.lastname')}</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className="mt-2"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="email">{t('signup.email')}</Label>
            <Input id="email" value={email} disabled className="mt-2" />
          </div>

          <div className="grid md:grid-cols-[1.2fr_2fr] gap-4">
            <div>
              <Label htmlFor="phoneCountry">{t('signup.phone.country')}</Label>
              <select
                id="phoneCountry"
                value={phoneCountry}
                onChange={(event) => setPhoneCountry(event.target.value)}
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t('signup.phone.country.placeholder')}</option>
                {countryOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="phone">{t('signup.phone')}</Label>
              <Input
                id="phone"
                type="tel"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                className="mt-2"
              />
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 bg-secondary rounded-lg">
            <Checkbox
              id="whatsappOptIn"
              checked={whatsappOptIn}
              onCheckedChange={(checked) => setWhatsappOptIn(checked as boolean)}
              className="mt-0.5"
            />
            <Label htmlFor="whatsappOptIn" className="cursor-pointer leading-relaxed">
              {t('signup.whatsapp.consent')}
            </Label>
          </div>

          <div className="flex items-start gap-3 p-4 bg-secondary rounded-lg">
            <Checkbox
              id="emailOptIn"
              checked={emailOptIn}
              onCheckedChange={(checked) => setEmailOptIn(checked as boolean)}
              className="mt-0.5"
            />
            <Label htmlFor="emailOptIn" className="cursor-pointer leading-relaxed">
              {t('signup.email.consent')}
            </Label>
          </div>

          <div>
            <Label htmlFor="language">{t('account.language')}</Label>
            <select
              id="language"
              value={languageValue}
              onChange={(event) => setLanguageValue(event.target.value as 'fr' | 'en')}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="fr">{t('language.fr')}</option>
              <option value="en">{t('language.en')}</option>
            </select>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <h2 className="font-serif font-semibold text-lg">{t('account.section.topics')}</h2>
          <div className="space-y-4">
            {TOPIC_KEYS.map((topicKey) => {
              const pref = topicPreferences.find((topic) => topic.topicKey === topicKey);
              const enabled = !!pref;
              return (
                <div key={topicKey} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={enabled}
                        onCheckedChange={(checked) => updateTopic(topicKey, checked as boolean)}
                      />
                      <span className="font-medium">{t(`topics.${topicKey}`)}</span>
                    </div>
                    {enabled && (
                      <span className="text-sm text-muted-foreground">
                        {pref?.articlesCount} {pref?.articlesCount === 1 ? t('articles.article') : t('articles.count')}
                      </span>
                    )}
                  </div>
                  {enabled && (
                    <div className="mt-4 flex items-center gap-4">
                      <span className="text-sm text-muted-foreground w-4">1</span>
                      <Slider
                        value={[pref?.articlesCount ?? 1]}
                        onValueChange={([value]) => updateTopicCount(topicKey, value)}
                        min={1}
                        max={3}
                        step={1}
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground w-4">3</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <h2 className="font-serif font-semibold text-lg">{t('account.section.password')}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="newPassword">{t('account.password.new')}</Label>
              <Input
                id="newPassword"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">{t('account.password.confirm')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-2"
              />
            </div>
          </div>
          {passwordMessage && (
            <div className="p-3 bg-secondary rounded-lg text-sm">
              {passwordMessage}
            </div>
          )}
          <Button onClick={handlePasswordUpdate} variant="outline" className="w-full">
            {t('account.password.update')}
          </Button>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <Button onClick={handleSave} className="flex-1 py-6">
            {t('account.save')}
          </Button>
          <Button onClick={handleSignOut} variant="outline" className="flex-1 py-6">
            {t('account.signout')}
          </Button>
        </div>

        <div className="pt-2">
          <Button onClick={handleUnsubscribe} variant="destructive" className="w-full py-6">
            {t('account.unsubscribe')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Account;
