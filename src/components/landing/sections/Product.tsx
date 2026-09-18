import type { ReactNode } from "react";
import { useLandingCopy } from "@/landing/useLandingCopy";
import { Container, DemoTag, SectionHeading } from "../Section";
import { AppSurface } from "../mockups/PhoneFrame";
import { EditionProgress, MiniCase, NewsCard, Question, StoryReader, TopicChip } from "../mockups/fragments";
import { cn } from "@/lib/utils";

const FormatCard = ({
  index,
  label,
  title,
  body,
  children,
  className,
}: {
  index: string;
  label: string;
  title: string;
  body: string;
  children: ReactNode;
  className?: string;
}) => (
  <article
    className={cn(
      "pn-reveal flex flex-col overflow-hidden rounded-[1.75rem] border border-pn-line bg-pn-raised shadow-pn-card",
      className
    )}
  >
    <div className="px-6 pb-6 pt-6 sm:px-8 sm:pt-8">
      <p className="flex items-center gap-3 text-pn-teal">
        <span className="font-serif text-sm font-semibold text-pn-gold">{index}</span>
        <span className="pn-eyebrow">{label}</span>
      </p>
      <h3 className="mt-3 font-serif text-[1.55rem] font-semibold leading-tight tracking-[-0.015em] text-pn-ink">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-pn-ink-soft">{body}</p>
    </div>
    {/* The fragment sits at the bottom of the card, cropped like a phone screen rising into view. */}
    <div className="relative mt-auto px-6 sm:px-10">
      <div className="mx-auto max-w-[23rem] text-[13.5px] sm:text-[14.5px]">{children}</div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-pn-raised to-transparent"
      />
    </div>
  </article>
);

const Product = () => {
  const { copy } = useLandingCopy();
  const { product } = copy;

  return (
    <section id="product" aria-labelledby="product-title" className="scroll-mt-20 py-20 sm:py-28">
      <Container>
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading id="product-title" eyebrow={product.eyebrow} title={product.title} lede={product.lede} />
          <DemoTag>{copy.illustrative}</DemoTag>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:gap-6">
          <FormatCard index="01" label={product.news.label} title={product.news.title} body={product.news.body}>
            <AppSurface className="h-[22em]">
              <div className="flex flex-wrap gap-[0.35em]">
                <TopicChip id="finance" />
                <TopicChip id="business" />
                <TopicChip id="tech_ai" />
              </div>
              <div className="mt-[0.7em]">
                <EditionProgress done={1} />
              </div>
              <div className="mt-[0.8em] space-y-[0.55em]">
                <NewsCard id="finance" minutes={3} done />
                <NewsCard id="business" minutes={2} />
              </div>
            </AppSurface>
          </FormatCard>

          <FormatCard index="02" label={product.story.label} title={product.story.title} body={product.story.body}>
            <AppSurface className="h-[22em]">
              <StoryReader />
            </AppSurface>
          </FormatCard>

          <FormatCard index="03" label={product.cases.label} title={product.cases.title} body={product.cases.body}>
            <AppSurface className="h-[22em]">
              <MiniCase showContext={false} />
            </AppSurface>
          </FormatCard>

          <FormatCard index="04" label={product.test.label} title={product.test.title} body={product.test.body}>
            <AppSurface className="h-[22em]">
              <Question />
            </AppSurface>
          </FormatCard>
        </div>
      </Container>
    </section>
  );
};

export default Product;
