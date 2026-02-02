import { useLanguage } from '@/contexts/LanguageContext';
import { useWizard } from '@/contexts/WizardContext';

const SummarySidebar = () => {
  const { language, t } = useLanguage();
  const { selectedTopics, topicPreferences } = useWizard();

  const getArticleCount = (topicKey: string): number => {
    const pref = topicPreferences.find(p => p.topicKey === topicKey);
    return pref?.articlesCount || 1;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
      <h3 className="font-serif font-semibold text-foreground mb-4">{t('summary.title')}</h3>
      
      <div className="space-y-3 text-sm">
        <div>
          <span className="text-muted-foreground">{t('summary.language')}:</span>
          <span className="ml-2 font-medium text-foreground">
            {language ? (language === 'fr' ? 'Français' : 'English') : '—'}
          </span>
        </div>
        
        <div>
          <span className="text-muted-foreground">{t('summary.topics')}:</span>
          {selectedTopics.length === 0 ? (
            <span className="ml-2 text-muted-foreground">{t('summary.none')}</span>
          ) : (
            <ul className="mt-1 space-y-1">
              {selectedTopics.map(topic => (
                <li key={topic} className="flex justify-between text-foreground">
                  <span>{t(`topics.${topic}`)}</span>
                  <span className="text-muted-foreground">
                    ×{getArticleCount(topic)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default SummarySidebar;
