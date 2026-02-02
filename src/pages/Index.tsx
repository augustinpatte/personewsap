import { useState, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWizard } from '@/contexts/WizardContext';
import LanguageStep from '@/components/steps/LanguageStep';
import TopicsStep from '@/components/steps/TopicsStep';
import ArticlesStep from '@/components/steps/ArticlesStep';
import SignupStep from '@/components/steps/SignupStep';
import ConfirmationStep from '@/components/steps/ConfirmationStep';

type WizardStep = 'language' | 'topics' | 'articles' | 'signup' | 'confirmation';

const Index = () => {
  const { language, setLanguage } = useLanguage();
  const { selectedTopics, resetWizard } = useWizard();
  const [currentStep, setCurrentStep] = useState<WizardStep>('language');
  const [articlesPageIndex, setArticlesPageIndex] = useState(0);

  // Calculate total article pages based on selected topics
  const totalArticlePages = useMemo(() => {
    return Math.ceil(selectedTopics.length / 2);
  }, [selectedTopics]);

  // Total wizard steps: language + topics + article pages + signup + confirmation
  const totalSteps = useMemo(() => {
    return 2 + totalArticlePages + 2; // language(1) + topics(1) + articles(N) + signup(1) + confirmation(1)
  }, [totalArticlePages]);

  const getCurrentStepNumber = (): number => {
    switch (currentStep) {
      case 'language': return 1;
      case 'topics': return 2;
      case 'articles': return 3 + articlesPageIndex;
      case 'signup': return 2 + totalArticlePages + 1;
      case 'confirmation': return totalSteps;
      default: return 1;
    }
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
      setArticlesPageIndex(prev => prev + 1);
    } else {
      setCurrentStep('signup');
    }
  };

  const handleArticlesBack = () => {
    if (articlesPageIndex > 0) {
      setArticlesPageIndex(prev => prev - 1);
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
    setCurrentStep('language');
    setArticlesPageIndex(0);
  };

  const renderStep = () => {
    switch (currentStep) {
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
