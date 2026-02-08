import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { loadPendingRegistration, clearPendingRegistration } from '@/lib/pendingRegistration';
import { completeRegistration } from '@/lib/registration';
import BrandHeader from '@/components/BrandHeader';

const Verify = () => {
  const { setLanguage, t } = useLanguage();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    email: string;
    topics: Array<{ topicKey: string; articlesCount: number }>;
    language: string | null;
  } | null>(null);

  useEffect(() => {
    const langParam = searchParams.get('lang');
    if (langParam === 'fr' || langParam === 'en') {
      setLanguage(langParam);
    }
  }, [searchParams, setLanguage]);

  useEffect(() => {
    const run = async () => {
      setStatus('loading');
      const { data } = await supabase.auth.getSession();
      if (!data.session?.user) {
        setStatus('error');
        setError(t('verify.no_session'));
        setDebug('No session found after email link. The link may have been opened in a different browser/profile.');
        return;
      }

      try {
        const pending = loadPendingRegistration();
        if (!pending) {
          setStatus('error');
          setError(t('verify.missing'));
          setDebug('No pending registration found for this email.');
          return;
        }

        setSummary({
          email: pending.user.email,
          topics: pending.topics,
          language: pending.language,
        });

        await completeRegistration(pending, data.session.user);
        clearPendingRegistration();
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setError(t('signup.error.generic'));
        setDebug(err instanceof Error ? err.message : String(err));
      }
    };

    run();
  }, [t]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-14">
        <BrandHeader />
        <div className="mb-8">
          <h1 className="font-serif text-3xl md:text-4xl font-semibold mb-2">
            {t('verify.title')}
          </h1>
          <p className="text-muted-foreground">{t('verify.subtitle')}</p>
        </div>

        {status === 'loading' && (
          <div className="p-6 bg-card border border-border rounded-lg">
            <p className="text-sm text-muted-foreground">{t('verify.processing')}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-lg space-y-3">
            <p className="text-destructive text-sm">{error}</p>
            {debug && (
              <p className="text-xs text-destructive/80 break-words">{debug}</p>
            )}
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-6">
            <div className="p-6 bg-card border border-border rounded-lg">
              <p className="text-lg font-medium">{t('verify.completed')}</p>
            </div>

            {summary && (
              <div className="p-6 bg-card border border-border rounded-lg">
                <div className="text-sm text-muted-foreground mb-2">{t('confirm.summary')}</div>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">{t('confirm.email')}: </span>
                    <span className="font-medium text-foreground">{summary.email}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('confirm.topics')}: </span>
                    <span className="font-medium text-foreground">
                      {summary.topics.map((topic) => t(`topics.${topic.topicKey}`)).join(', ')}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <Button onClick={() => navigate('/')} className="w-full py-6">
              {t('confirm.edit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Verify;
