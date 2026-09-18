import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE_ORIGIN = "https://personewsap.com";

/**
 * One canonical URL per route. Set per path rather than hard-coded in
 * index.html, where a single canonical would point every page — privacy and
 * support included — at the home page.
 */
const CanonicalLink = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = `${SITE_ORIGIN}${pathname === "/" ? "/" : pathname.replace(/\/+$/, "")}`;
  }, [pathname]);

  return null;
};

export default CanonicalLink;
