import { Link } from 'react-router-dom';

const BrandHeader = () => {
  return (
    <header className="mb-10">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img
            src="/logo-blue.png"
            alt="PersoNewsAP"
            className="h-10 w-10"
          />
          <span className="text-2xl md:text-3xl font-serif font-semibold text-[#064FAD]">
            PersoNewsAP
          </span>
        </Link>
      </div>
    </header>
  );
};

export default BrandHeader;
