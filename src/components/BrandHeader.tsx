import { Link } from 'react-router-dom';

const BrandHeader = () => {
  return (
    <header className="mb-8">
      <div className="flex items-center justify-between">
        <Link to="/" className="text-2xl md:text-3xl font-serif font-semibold text-[#013360]">
          PersoNewsAP
        </Link>
      </div>
      {import.meta.env.DEV && (
        <p className="mt-2 text-xs text-muted-foreground">
          Supabase URL: {import.meta.env.VITE_SUPABASE_URL}
        </p>
      )}
    </header>
  );
};

export default BrandHeader;
