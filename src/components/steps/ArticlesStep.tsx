import { useLanguage } from '@/contexts/LanguageContext';
import { useWizard } from '@/contexts/WizardContext';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import WizardLayout from '@/components/WizardLayout';

interface ArticlesStepProps {
  pageIndex: number;
  totalArticlePages: number;
  onNext: () => void;
  onBack: () => void;
  totalSteps: number;
  currentStep: number;
}

const ArticlesStep = ({ 
  pageIndex, 
  totalArticlePages, 
  onNext, 
  onBack, 
  totalSteps,
  currentStep,
}: ArticlesStepProps) => {
  const { t } = useLanguage();
  const { selectedTopics, topicPreferences, updateTopicArticleCount } = useWizard();

  // Get the 2 topics for this page
  const startIndex = pageIndex * 2;
  const topicsForPage = selectedTopics.slice(startIndex, startIndex + 2);

  const getArticleCount = (topicKey: string): number => {
    const pref = topicPreferences.find(p => p.topicKey === topicKey);
    return pref?.articlesCount || 1;
  };

  return (
    <WizardLayout currentStep={currentStep} totalSteps={totalSteps}>
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="font-serif text-2xl md:text-3xl font-semibold text-foreground mb-2">
            {t('articles.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('articles.subtitle')}
          </p>
        </div>

        <div className="space-y-8 mb-8">
          {topicsForPage.map(topicKey => {
            const count = getArticleCount(topicKey);
            return (
              <div 
                key={topicKey}
                className="bg-card border border-border rounded-lg p-6"
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-lg text-foreground">
                    {t(`topics.${topicKey}`)}
                  </h3>
                  <span className="text-accent font-medium text-lg">
                    {count} {count === 1 ? t('articles.article') : t('articles.count')}
                  </span>
                </div>
                
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground w-4">1</span>
                  <Slider
                    value={[count]}
                    onValueChange={([value]) => updateTopicArticleCount(topicKey, value)}
                    min={1}
                    max={3}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground w-4">3</span>
                </div>
                
                <div className="flex justify-between mt-2 px-4">
                  {[1, 2, 3].map(n => (
                    <button
                      key={n}
                      onClick={() => updateTopicArticleCount(topicKey, n)}
                      className={`w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                        count === n
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-secondary text-secondary-foreground hover:bg-muted'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={onBack}
            className="flex-1 py-6"
            size="lg"
          >
            {t('nav.back')}
          </Button>
          <Button
            onClick={onNext}
            className="flex-1 py-6"
            size="lg"
          >
            {t('nav.continue')}
          </Button>
        </div>
      </div>
    </WizardLayout>
  );
};

export default ArticlesStep;
