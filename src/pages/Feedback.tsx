import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import BrandHeader from '@/components/BrandHeader';

type Rating = 'good' | 'average' | 'bad';

const Feedback = () => {
  const { setLanguage, t } = useLanguage();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [rating, setRating] = useState<Rating | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const langParam = searchParams.get('lang');
    if (langParam === 'fr' || langParam === 'en') {
      setLanguage(langParam);
    }
  }, [searchParams, setLanguage]);

  useEffect(() => {
    const emailParam = searchParams.get('email');
    const issueParam = searchParams.get('issue');
    if (emailParam) setEmail(emailParam);
    if (issueParam) setIssueDate(issueParam);
  }, [searchParams]);

  const ratingOptions = useMemo(
    () => [
      { value: 'good' as const, label: t('feedback.good') },
      { value: 'average' as const, label: t('feedback.average') },
      { value: 'bad' as const, label: t('feedback.bad') },
    ],
    [t]
  );

  const handleSubmit = async () => {
    setError(null);
    if (!email.trim() || !rating) {
      setError(t('feedback.error'));
      return;
    }

    setSubmitting(true);

    const { error: insertError } = await supabase
      .from('newsletter_feedback')
      .insert({
        email: email.trim().toLowerCase(),
        issue_date: issueDate || null,
        rating,
        message: message.trim() || null,
      });

    if (insertError) {
      setError(t('feedback.error'));
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-14">
        <BrandHeader />
        <div className="mb-8">
          <h1 className="font-serif text-3xl md:text-4xl font-semibold mb-2">
            {t('feedback.title')}
          </h1>
          <p className="text-muted-foreground">{t('feedback.subtitle')}</p>
        </div>

        {submitted ? (
          <div className="p-6 bg-card border border-border rounded-lg">
            <p className="text-lg font-medium">{t('feedback.thanks')}</p>
          </div>
        ) : (
          <div className="space-y-6 bg-card border border-border rounded-lg p-6">
            <div>
              <Label htmlFor="email">{t('feedback.email')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="issue">{t('feedback.issue')}</Label>
              <Input
                id="issue"
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
                className="mt-2"
              />
            </div>

            <div>
              <Label>{t('feedback.rating')}</Label>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {ratingOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={rating === option.value ? 'default' : 'outline'}
                    onClick={() => setRating(option.value)}
                    className="py-6"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="message">{t('feedback.message')}</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="mt-2"
                rows={4}
              />
            </div>

            {error && (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-destructive text-sm">{error}</p>
              </div>
            )}

            <Button onClick={handleSubmit} disabled={submitting} className="w-full py-6">
              {submitting ? '...' : t('feedback.submit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Feedback;
