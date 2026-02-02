import { useLanguage } from '@/contexts/LanguageContext';
import { useWizard } from '@/contexts/WizardContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import WizardLayout from '@/components/WizardLayout';

interface TopicsStepProps {
  onNext: () => void;
  onBack: () => void;
  totalSteps: number;
}

const TOPIC_KEYS = [
  'sport',
  'international',
  'finance',
  'stocks',
  'automotive',
  'pharma',
  'ai',
  'culture',
];

const TopicsStep = ({ onNext, onBack, totalSteps }: TopicsStepProps) => {
  const { t } = useLanguage();
  const { selectedTopics, setSelectedTopics, setTopicPreferences } = useWizard();

  const handleToggle = (topicKey: string) => {
    setSelectedTopics(
      selectedTopics.includes(topicKey)
        ? selectedTopics.filter(t => t !== topicKey)
        : [...selectedTopics, topicKey]
    );
  };

  const handleContinue = () => {
    // Initialize topic preferences with default count of 1
    const prefs = selectedTopics.map(topicKey => ({
      topicKey,
      articlesCount: 1,
    }));
    setTopicPreferences(prefs);
    onNext();
  };

  return (
    <WizardLayout currentStep={2} totalSteps={totalSteps}>
      <div className="animate-fade-in">
        <div className="mb-8">
          <h1 className="font-serif text-2xl md:text-3xl font-semibold text-foreground mb-2">
            {t('topics.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('topics.subtitle')}
          </p>
        </div>

        <div className="grid gap-3 mb-8">
          {TOPIC_KEYS.map(topicKey => (
            <label
              key={topicKey}
              className={`flex items-center gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                selectedTopics.includes(topicKey)
                  ? 'border-selection-border bg-selection-bg'
                  : 'border-border bg-card hover:border-muted-foreground/30'
              }`}
            >
              <Checkbox
                checked={selectedTopics.includes(topicKey)}
                onCheckedChange={() => handleToggle(topicKey)}
                className="h-5 w-5"
              />
              <span className="font-medium text-foreground">
                {t(`topics.${topicKey}`)}
              </span>
            </label>
          ))}
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
            onClick={handleContinue}
            disabled={selectedTopics.length === 0}
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

export default TopicsStep;
