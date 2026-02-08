import type { Language } from '@/contexts/LanguageContext';

export interface PendingRegistration {
  language: Language;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    whatsappOptIn: boolean;
    emailOptIn: boolean;
  };
  topics: Array<{
    topicKey: string;
    articlesCount: number;
  }>;
  createdAt: string;
}

const STORAGE_KEY = 'pendingRegistration';

export const savePendingRegistration = (data: PendingRegistration) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const loadPendingRegistration = (): PendingRegistration | null => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingRegistration;
  } catch {
    return null;
  }
};

export const clearPendingRegistration = () => {
  window.localStorage.removeItem(STORAGE_KEY);
};
