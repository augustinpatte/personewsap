import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { PendingRegistration } from '@/lib/pendingRegistration';

export const signUpWithPassword = async (email: string, password: string) => {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/verify`,
    },
  });
};

export const resendSignupEmail = async (email: string) => {
  return supabase.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/verify`,
    },
  });
};

export const sendPasswordResetEmail = async (email: string) => {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/account`,
  });
};

export const completeRegistration = async (pending: PendingRegistration, authUser: User) => {
  const pendingEmail = pending.user.email.trim().toLowerCase();
  const authEmail = authUser.email?.trim().toLowerCase();

  if (!authEmail || authEmail !== pendingEmail) {
    throw new Error('email_mismatch');
  }

  const { data: existing, error: existingError } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  let userId = existing?.id ?? null;

  if (!userId) {
    const { data: created, error: createError } = await supabase
      .from('users')
      .insert({
        auth_user_id: authUser.id,
        language: pending.language ?? 'en',
        first_name: pending.user.firstName.trim(),
        last_name: pending.user.lastName.trim(),
        email: pendingEmail,
        phone: pending.user.phone,
        whatsapp_opt_in: pending.user.whatsappOptIn,
        email_opt_in: pending.user.emailOptIn,
        verified_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (createError) {
      throw createError;
    }

    userId = created.id;
  } else {
    const { error: updateError } = await supabase
      .from('users')
      .update({
        language: pending.language ?? 'en',
        first_name: pending.user.firstName.trim(),
        last_name: pending.user.lastName.trim(),
        email: pendingEmail,
        phone: pending.user.phone,
        whatsapp_opt_in: pending.user.whatsappOptIn,
        email_opt_in: pending.user.emailOptIn,
        verified_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) {
      throw updateError;
    }
  }

  const topicRows = pending.topics.map((pref) => ({
    user_id: userId,
    topic_name: pref.topicKey,
    articles_count: pref.articlesCount,
  }));

  if (topicRows.length > 0) {
    const { error: topicsError } = await supabase
      .from('user_topics')
      .upsert(topicRows, { onConflict: 'user_id,topic_name' });

    if (topicsError) {
      throw topicsError;
    }
  }

  return userId;
};
