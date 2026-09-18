import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import BrandHeader from "@/components/BrandHeader";
import { useLanguage } from "@/contexts/LanguageContext";

const NotFound = () => {
  const location = useLocation();
  const { t } = useLanguage();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="text-center">
        <BrandHeader />
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">404</p>
        <h1 className="mt-3 text-3xl font-semibold">{t('notfound.title')}</h1>
        <p className="mt-3 text-muted-foreground">{t('notfound.body')}</p>
        <Link to="/" className="mt-6 inline-block text-primary underline hover:text-primary/90">
          {t('notfound.home')}
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
