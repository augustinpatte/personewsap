import { Link } from 'react-router-dom';

const BrandHeader = () => {
  return (
    <header className="mb-14">
      <div className="flex items-center justify-center">
        <Link to="/" className="flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
          <img
            src="/logo-blue.png"
            alt="PersoNewsAP"
            className="h-20 w-20 md:h-24 md:w-24"
          />
          <span
            className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-[0.03em] text-[#054EAB] text-center sm:text-left"
            style={{ fontFamily: '"Cinzel", "Source Serif 4", serif' }}
          >
            PersoNewsAP
          </span>
        </Link>
      </div>
    </header>
  );
};

export default BrandHeader;
