import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import LegalPageShell from './legal/LegalPageShell';
import { ACCOUNT_DELETION_ENDPOINT, legalCopy } from './legal/legalCopy';

/**
 * The external account-deletion URL the stores require, so someone can delete
 * their account without installing the app.
 *
 * It deliberately offers no way to type an email address. A form that deletes
 * "whatever account this address belongs to" is an account-takeover primitive;
 * the only account this page can remove is the one the visitor is signed in
 * with, and the deletion is authorised by their own session token, verified
 * server-side. A signed-out visitor is sent to sign in first.
 */
type Status = 'idle' | 'deleting' | 'deleted' | 'error' | 'unauthorized';

const DeleteAccount = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const copy = legalCopy[language === 'fr' ? 'fr' : 'en'].deleteAccount;

  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    let active = true;

    const readSession = async () => {
      const { data } = await supabase.auth.getSession();

      if (!active) {
        return;
      }

      setEmail(data.session?.user.email ?? null);
      setCheckingSession(false);
    };

    void readSession().catch(() => {
      if (active) {
        setCheckingSession(false);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const handleDelete = useCallback(async () => {
    if (!ACCOUNT_DELETION_ENDPOINT) {
      setStatus('error');
      return;
    }

    setStatus('deleting');

    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      setStatus('unauthorized');
      return;
    }

    try {
      const response = await fetch(ACCOUNT_DELETION_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        // No identifier is sent: the server derives the account from the token.
        body: JSON.stringify({})
      });

      if (response.status === 401) {
        setStatus('unauthorized');
        return;
      }

      if (!response.ok) {
        setStatus('error');
        return;
      }

      // The account is gone, so the local session is meaningless.
      await supabase.auth.signOut();
      setStatus('deleted');
    } catch {
      setStatus('error');
    }
  }, []);

  return (
    <LegalPageShell eyebrow={copy.eyebrow} title={copy.title}>
      {status === 'deleted' ? (
        <section className="space-y-3 rounded-lg border bg-muted/30 p-5">
          <h2 className="text-lg font-semibold tracking-tight">{copy.successHeading}</h2>
          <p>{copy.successBody}</p>
          <Button onClick={() => navigate('/')} variant="outline">
            PersoNewsAP
          </Button>
        </section>
      ) : (
        <>
          {copy.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {copy.whatIsDeletedHeading}
            </h2>
            <ul className="list-disc space-y-1.5 pl-5">
              {copy.whatIsDeleted.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {copy.whatIsKeptHeading}
            </h2>
            <ul className="list-disc space-y-1.5 pl-5">
              {copy.whatIsKept.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </section>

          {checkingSession ? null : email ? (
            <section className="space-y-4 rounded-lg border bg-muted/30 p-5">
              <h2 className="text-lg font-semibold tracking-tight">
                {copy.confirmHeading}
              </h2>
              <p className="text-sm text-muted-foreground">{copy.signedInAs(email)}</p>
              <p>{copy.confirmBody}</p>

              <label className="flex items-start gap-3 text-sm">
                <input
                  checked={acknowledged}
                  className="mt-1 h-4 w-4"
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  type="checkbox"
                />
                <span>{copy.confirmCheckbox}</span>
              </label>

              {!ACCOUNT_DELETION_ENDPOINT ? (
                <p className="text-sm text-muted-foreground">{copy.notConfigured}</p>
              ) : null}

              {status === 'error' ? (
                <div className="space-y-1">
                  <p className="font-medium">{copy.errorHeading}</p>
                  <p className="text-sm text-muted-foreground">{copy.errorBody}</p>
                </div>
              ) : null}

              {status === 'unauthorized' ? (
                <p className="text-sm text-muted-foreground">{copy.unauthorized}</p>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={
                    !acknowledged || status === 'deleting' || !ACCOUNT_DELETION_ENDPOINT
                  }
                  onClick={() => void handleDelete()}
                  variant="destructive"
                >
                  {status === 'deleting' ? copy.deleting : copy.deleteCta}
                </Button>
                <Button asChild variant="outline">
                  <Link to="/">{copy.cancel}</Link>
                </Button>
              </div>
            </section>
          ) : (
            <section className="space-y-4 rounded-lg border bg-muted/30 p-5">
              <h2 className="text-lg font-semibold tracking-tight">
                {copy.signedOutHeading}
              </h2>
              <p>{copy.signedOutBody}</p>
              <Button asChild>
                <Link to="/login?redirect=/delete-account">{copy.signInCta}</Link>
              </Button>
            </section>
          )}
        </>
      )}
    </LegalPageShell>
  );
};

export default DeleteAccount;
