import { useLayoutEffect } from "react";

/**
 * Fades `.pn-reveal` elements in as they enter the viewport. The hidden state
 * only exists under `html.pn-js`, which this hook sets, so nothing is ever
 * hidden without a working observer; reduced-motion readers get the CSS
 * override in index.css.
 */
export function useReveal() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!("IntersectionObserver" in window)) return;

    root.classList.add("pn-js");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );

    document.querySelectorAll(".pn-reveal").forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      root.classList.remove("pn-js");
    };
  }, []);
}
