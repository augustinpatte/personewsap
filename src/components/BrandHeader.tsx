import { Link } from 'react-router-dom';

/**
 * Masthead for the account and legal pages: the app icon and the serif
 * wordmark, the same lockup as the home page header.
 */
const BrandHeader = () => {
  return (
    <header className="mb-14">
      <div className="flex items-center justify-center">
        <Link to="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <img
            src="/app-icon-128.png"
            alt=""
            width={48}
            height={48}
            className="h-11 w-11 rounded-[12px] md:h-12 md:w-12"
          />
          <span
            className="text-3xl font-semibold tracking-[-0.01em] text-[#1C1A16] md:text-4xl"
            style={{ fontFamily: '"Source Serif 4", Georgia, serif' }}
          >
            PersoNews<span className="text-[#0F5B5F]">AP</span>
          </span>
        </Link>
      </div>
    </header>
  );
};

export default BrandHeader;
