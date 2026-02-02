import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface TopicPreference {
  topicKey: string;
  articlesCount: number;
}

export interface UserData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  whatsappOptIn: boolean;
  emailOptIn: boolean;
}

interface WizardContextType {
  selectedTopics: string[];
  setSelectedTopics: (topics: string[]) => void;
  topicPreferences: TopicPreference[];
  setTopicPreferences: (prefs: TopicPreference[]) => void;
  updateTopicArticleCount: (topicKey: string, count: number) => void;
  userData: UserData;
  setUserData: (data: UserData) => void;
  registeredUserId: string | null;
  setRegisteredUserId: (id: string | null) => void;
  resetWizard: () => void;
}

const defaultUserData: UserData = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  whatsappOptIn: false,
  emailOptIn: false,
};

const WizardContext = createContext<WizardContextType | undefined>(undefined);

export const WizardProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [topicPreferences, setTopicPreferences] = useState<TopicPreference[]>([]);
  const [userData, setUserData] = useState<UserData>(defaultUserData);
  const [registeredUserId, setRegisteredUserId] = useState<string | null>(null);

  const updateTopicArticleCount = (topicKey: string, count: number) => {
    setTopicPreferences(prev => {
      const existing = prev.find(p => p.topicKey === topicKey);
      if (existing) {
        return prev.map(p => p.topicKey === topicKey ? { ...p, articlesCount: count } : p);
      }
      return [...prev, { topicKey, articlesCount: count }];
    });
  };

  const resetWizard = () => {
    setSelectedTopics([]);
    setTopicPreferences([]);
    setUserData(defaultUserData);
    setRegisteredUserId(null);
  };

  return (
    <WizardContext.Provider value={{
      selectedTopics,
      setSelectedTopics,
      topicPreferences,
      setTopicPreferences,
      updateTopicArticleCount,
      userData,
      setUserData,
      registeredUserId,
      setRegisteredUserId,
      resetWizard,
    }}>
      {children}
    </WizardContext.Provider>
  );
};

export const useWizard = (): WizardContextType => {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error('useWizard must be used within a WizardProvider');
  }
  return context;
};
