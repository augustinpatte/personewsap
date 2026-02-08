import { useState, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWizard } from '@/contexts/WizardContext';
import EntryStep from '@/components/steps/EntryStep';
import LanguageStep from '@/components/steps/LanguageStep';
import TopicsStep from '@/components/steps/TopicsStep';
import ArticlesStep from '@/components/steps/ArticlesStep';
import SignupStep from '@/components/steps/SignupStep';
import ConfirmationStep from '@/components/steps/ConfirmationStep';

type WizardStep = 'entry' | 'language' | 'topics' | 'articles' | 'signup' | 'confirmation';

const Index = () => {
  const { setLanguage } = useLanguage();
  const { selectedTopics, resetWizard } = useWizard();
  const [currentStep, setCurrentStep] = useState<WizardStep>('entry');
  const [articlesPageIndex, setArticlesPageIndex] = useState(0);

  const totalArticlePages = useMemo(() => {
    return Math.ceil(selectedTopics.length / 2);
  }, [selectedTopics]);

  const totalSteps = useMemo(() => {
    return 3 + totalArticlePages + 1; // entry(1) + language(1) + topics(1) + articles(N) + signup(1) + confirmation(1)
  }, [totalArticlePages]);

  const getCurrentStepNumber = (): number => {
    switch (currentStep) {
      case 'entry': return 1;
      case 'language': return 2;
      case 'topics': return 3;
      case 'articles': return 4 + articlesPageIndex;
      case 'signup': return 3 + totalArticlePages + 1;
      case 'confirmation': return totalSteps;
      default: return 1;
    }
  };

  const handleEntrySubscribe = () => {
    setCurrentStep('language');
  };

  const handleEntryLogin = () => {
    window.location.href = '/login';
  };

  const handleLanguageNext = () => {
    setCurrentStep('topics');
  };

  const handleTopicsNext = () => {
    setArticlesPageIndex(0);
    setCurrentStep('articles');
  };

  const handleTopicsBack = () => {
    setCurrentStep('language');
  };

  const handleArticlesNext = () => {
    if (articlesPageIndex < totalArticlePages - 1) {
      setArticlesPageIndex((prev) => prev + 1);
    } else {
      setCurrentStep('signup');
    }
  };

  const handleArticlesBack = () => {
    if (articlesPageIndex > 0) {
      setArticlesPageIndex((prev) => prev - 1);
    } else {
      setCurrentStep('topics');
    }
  };

  const handleSignupNext = () => {
    setCurrentStep('confirmation');
  };

  const handleSignupBack = () => {
    setArticlesPageIndex(totalArticlePages - 1);
    setCurrentStep('articles');
  };

  const handleEditPreferences = () => {
    resetWizard();
    setLanguage(null);
    setCurrentStep('entry');
    setArticlesPageIndex(0);
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'entry':
        return <EntryStep onSubscribe={handleEntrySubscribe} onLogin={handleEntryLogin} />;
      case 'language':
        return <LanguageStep onNext={handleLanguageNext} />;
      case 'topics':
        return (
          <TopicsStep
            onNext={handleTopicsNext}
            onBack={handleTopicsBack}
            totalSteps={totalSteps}
          />
        );
      case 'articles':
        return (
          <ArticlesStep
            pageIndex={articlesPageIndex}
            totalArticlePages={totalArticlePages}
            onNext={handleArticlesNext}
            onBack={handleArticlesBack}
            totalSteps={totalSteps}
            currentStep={getCurrentStepNumber()}
          />
        );
      case 'signup':
        return (
          <SignupStep
            onNext={handleSignupNext}
            onBack={handleSignupBack}
            totalSteps={totalSteps}
            currentStep={getCurrentStepNumber()}
          />
        );
      case 'confirmation':
        return (
          <ConfirmationStep
            onEdit={handleEditPreferences}
            totalSteps={totalSteps}
          />
        );
      default:
        return <LanguageStep onNext={handleLanguageNext} />;
    }
  };

  return renderStep();
};

export default Index;
