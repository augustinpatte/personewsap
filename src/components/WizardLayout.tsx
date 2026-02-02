import { ReactNode } from 'react';
import ProgressIndicator from './ProgressIndicator';
import SummarySidebar from './SummarySidebar';
import { useLanguage } from '@/contexts/LanguageContext';

interface WizardLayoutProps {
  children: ReactNode;
  currentStep: number;
  totalSteps: number;
  showSidebar?: boolean;
  showProgress?: boolean;
}

const WizardLayout = ({ 
  children, 
  currentStep, 
  totalSteps,
  showSidebar = true,
  showProgress = true,
}: WizardLayoutProps) => {
  const { language } = useLanguage();

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-5xl mx-auto px-4 py-8 md:py-12">
        {showProgress && language && (
          <ProgressIndicator currentStep={currentStep} totalSteps={totalSteps} />
        )}
        
        <div className={`flex flex-col ${showSidebar && language ? 'lg:flex-row lg:gap-8' : ''}`}>
          <div className={`flex-1 ${showSidebar && language ? 'lg:max-w-2xl' : ''}`}>
            {children}
          </div>
          
          {showSidebar && language && (
            <div className="mt-8 lg:mt-0 lg:w-64 lg:flex-shrink-0">
              <div className="lg:sticky lg:top-8">
                <SummarySidebar />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WizardLayout;
