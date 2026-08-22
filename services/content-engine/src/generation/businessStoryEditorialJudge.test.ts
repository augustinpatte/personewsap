import { describe, expect, it } from "vitest";

import type { BusinessStory, Language } from "../domain.js";
import {
  buildBusinessStoryJudgePrompt,
  businessStoryJudgeRejectionReasons,
  parseBusinessStoryJudgeVerdict,
  type BusinessStoryJudgeVerdict
} from "./businessStoryEditorialJudge.js";
import { validateBusinessStorySubstance } from "./businessStorySubstance.js";

/**
 * Two real candidates from the latest 5-story replace batch passed everything.
 *
 *   BS-02  a competent, well-sourced piece about US–Canada trade negotiations,
 *          50% tariffs and dollar-for-dollar retaliation. Nothing about it is
 *          self-refuting. It simply must not be in this product.
 *   BS-04  said the source does not describe the Treasury measure, that no
 *          amount, duration or channel is known, and that the operational
 *          trade-off cannot be established — none of it in a phrasing the
 *          substance regexes knew.
 *
 * Neither is reachable by adding more phrases: the first is not a wording
 * problem at all, and the second is a paraphrase away from any blocklist. The
 * judgement is delegated, and these tests pin the contract that carries it.
 *
 * What a unit test can settle is the contract: that the judge is asked the right
 * question, that a failing verdict refuses the story with a reason an operator
 * can act on, and that an unusable answer refuses too. Whether Luna classifies a
 * given piece correctly is model behaviour, which is exactly why the gate is
 * fail-closed.
 */

function story(overrides: Partial<BusinessStory> = {}): BusinessStory {
  return {
    content_type: "business_story",
    slot: "business_story",
    topic: "business",
    language: "en" as Language,
    title: "How a fab traced a yield loss to one deposition step",
    company_or_market: "Contract chipmaker",
    story_date: "2026-08-20",
    setup: "Yield on a mature node fell four points over three weeks.",
    tension: "Scrapping the lot costs 2M dollars; running blind costs more.",
    decision: "The team held the line and instrumented one deposition step.",
    outcome: "Yield recovered to 94% once the chamber was recalibrated.",
    lesson: "Root-cause discipline is cheaper than replacing capacity.",
    body_md:
      "The fab held production while it instrumented a single step. Yield returned to 94%, and the fix cost less than a week of scrapped wafers.",
    editorial_memory: {
      entity_name: "Contract chipmaker",
      entity_type: "company",
      main_company: "Contract chipmaker",
      companies_mentioned: ["Contract chipmaker"],
      industry: "semiconductors",
      key_mechanism: "yield economics",
      secondary_mechanisms: [],
      strategic_angle: "instrument before replacing",
      core_takeaway: "Find the step before buying the capacity.",
      year_period: "2020s"
    },
    source_urls: ["https://sources.test/semis/1"],
    version: 1,
    ...overrides
  } as BusinessStory;
}

/** BS-04: the operational trade-off cannot be established. */
const MARKETS_REFUSE_TO_BE_REASSURED = story({
  language: "fr",
  title: "When Markets Refuse to Be Reassured",
  setup: "Le Trésor a annoncé une mesure de soutien dont le contenu n'est pas détaillé.",
  decision: "Il faudrait connaître le montant et le canal avant de trancher.",
  outcome: "L'arbitrage opérationnel ne peut pas être établi à partir de cette source.",
  lesson: "La source ne décrit pas la mesure : ni montant, ni durée, ni canal.",
  body_md:
    "La source ne décrit pas la mesure du Trésor. Ni le montant, ni la durée, ni le canal ne sont connus, et l'arbitrage opérationnel ne peut pas être établi. Des preuves supplémentaires sont nécessaires."
});

/** BS-02: well written, well sourced, and a political story. */
const TARIFF_RETALIATION = story({
  title: "Ottawa answers Washington dollar for dollar",
  company_or_market: "US–Canada trade",
  setup: "Washington set 50% tariffs on a list of Canadian goods.",
  tension: "Ottawa faces pressure to retaliate in kind before the next round of talks.",
  decision: "Ottawa announced dollar-for-dollar retaliatory tariffs.",
  outcome: "Negotiations resumed with both sides holding their positions.",
  lesson: "Retaliation is leverage in a negotiation between governments.",
  body_md:
    "Washington imposed 50% tariffs. Ottawa retaliated dollar for dollar, and the two governments returned to the negotiating table with the political cost of backing down now higher on both sides.",
  editorial_memory: {
    ...story().editorial_memory!,
    industry: "trade policy",
    key_mechanism: "negotiating leverage"
  }
});

/** Neutral macro: allowed. */
const SOVEREIGN_DEBT = story({
  title: "What $1 trillion of annual interest does to fiscal room",
  company_or_market: "US Treasury market",
  setup: "Federal debt passed $40 trillion and annual interest passed $1 trillion.",
  tension: "Every point of average coupon now costs more than a cabinet department.",
  decision: "Issuance was shifted toward the short end to hold the average cost down.",
  outcome: "Financial flexibility narrows as more of the budget is pre-committed.",
  lesson: "Interest cost is the constraint that decides what else can be funded.",
  body_md:
    "With $40 trillion outstanding and interest above $1 trillion a year, the average coupon decides how much room is left. Shifting issuance short lowers today's cost and raises refinancing risk.",
  editorial_memory: {
    ...story().editorial_memory!,
    industry: "public finance",
    key_mechanism: "cost of debt and financial flexibility"
  }
});

const PASSING: BusinessStoryJudgeVerdict = {
  pass: true,
  business_mechanism_substantive: true,
  source_support_sufficient: true,
  editorial_self_refusal: false,
  fr_en_semantic_parity: true,
  political_geopolitical_exclusion_pass: true,
  topic_promise_fit: true,
  reasons: []
};

describe("the judge is asked the right question", () => {
  it("carries the political exclusion as a policy, not a word list", () => {
    const prompt = buildBusinessStoryJudgePrompt({
      reference: { language: "en", item: TARIFF_RETALIATION },
      counterpart: { language: "fr", item: TARIFF_RETALIATION }
    });

    expect(prompt).toContain("geopolitical confrontation");
    expect(prompt).toContain("tariffs and trade retaliation framed as a conflict between governments");
    // And what stays allowed, so a rates or debt story is not swept up with it.
    expect(prompt).toContain("central-bank and Federal Reserve actions");
    expect(prompt).toContain("sovereign debt");
    expect(prompt).toContain("The test is what the piece is ABOUT, not which words it contains");
  });

  it("asks for parity only when there are two versions", () => {
    const paired = buildBusinessStoryJudgePrompt({
      reference: { language: "fr", item: story({ language: "fr" }) },
      counterpart: { language: "en", item: story() }
    });
    const single = buildBusinessStoryJudgePrompt({
      reference: { language: "en", item: story() }
    });

    expect(paired).toContain("the two language versions differ materially");
    // The daily job generates one language per run: there is no pair to compare.
    expect(single).toContain("There is only one language version here");
    expect(JSON.parse(single).versions).toHaveLength(1);
    expect(JSON.parse(paired).versions).toHaveLength(2);
  });

  it("sends the prose the judgement depends on", () => {
    const prompt = buildBusinessStoryJudgePrompt({
      reference: { language: "fr", item: MARKETS_REFUSE_TO_BE_REASSURED }
    });

    expect(prompt).toContain("l'arbitrage opérationnel ne peut pas être établi");
    expect(prompt).toContain("When Markets Refuse to Be Reassured");
  });
});

describe("the real failures are refused", () => {
  it("refuses BS-04 for evidence the sources do not carry", () => {
    const reasons = businessStoryJudgeRejectionReasons({
      ...PASSING,
      pass: false,
      source_support_sufficient: false,
      editorial_self_refusal: true
    });

    expect(reasons.join(" ")).toContain("do not establish the trade-off");
    expect(reasons.join(" ")).toContain("note asking for more evidence");
  });

  it("refuses BS-02 on the political exclusion, not on quality", () => {
    const reasons = businessStoryJudgeRejectionReasons({
      ...PASSING,
      pass: false,
      political_geopolitical_exclusion_pass: false
    });

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("political or geopolitical");
    // The point of the message: it is not a quality complaint.
    expect(reasons[0]).toContain("however well sourced");
  });

  it("shows that the deterministic gate catches neither", () => {
    // BS-02 is not self-refuting in any way a regex could see: it is a
    // competent piece about the wrong subject.
    expect(validateBusinessStorySubstance(TARIFF_RETALIATION)).toEqual([]);

    // BS-04 slips through too, and this is the part worth keeping. It says
    // "l'arbitrage opérationnel ne peut pas être établi" and "des preuves
    // supplémentaires sont nécessaires" — the same refusal the gate was written
    // for, in wordings it does not know. "arbitrage opérationnel" is not in its
    // list of evidence objects, and "preuves supplémentaires" is not "preuves
    // insuffisantes".
    //
    // Adding those two phrases would fix these two stories and nothing else.
    // That is why the judgement is delegated rather than enumerated.
    expect(validateBusinessStorySubstance(MARKETS_REFUSE_TO_BE_REASSURED)).toEqual([]);
  });
});

describe("legitimate stories are not swept up", () => {
  it("accepts the semiconductor root-cause story", () => {
    expect(businessStoryJudgeRejectionReasons(PASSING)).toEqual([]);
    expect(validateBusinessStorySubstance(story())).toEqual([]);
  });

  it("accepts the sovereign debt story as neutral economics", () => {
    // Debt, rates and Treasury issuance are explicitly inside the promise.
    expect(businessStoryJudgeRejectionReasons(PASSING)).toEqual([]);
    expect(validateBusinessStorySubstance(SOVEREIGN_DEBT)).toEqual([]);

    const prompt = buildBusinessStoryJudgePrompt({ reference: { language: "en", item: SOVEREIGN_DEBT } });
    expect(prompt).toContain("interest rates, sovereign debt");
  });

  it("accepts an ordinary pricing and unit-economics story", () => {
    const pricing = story({
      title: "Why a distributor repriced 40 lines instead of all of them",
      lesson: "Selection defends margin better than a uniform increase.",
      editorial_memory: { ...story().editorial_memory!, key_mechanism: "pricing power" }
    });

    expect(validateBusinessStorySubstance(pricing)).toEqual([]);
    expect(businessStoryJudgeRejectionReasons(PASSING)).toEqual([]);
  });
});

describe("an unusable answer never lets a story through", () => {
  it("refuses a malformed payload", () => {
    for (const payload of [null, undefined, "nope", {}, { pass: "yes" }]) {
      const verdict = parseBusinessStoryJudgeVerdict(payload);

      expect(verdict.pass).toBe(false);
      expect(businessStoryJudgeRejectionReasons(verdict)).not.toEqual([]);
    }
  });

  it("treats every missing boolean as a refusal, not a default pass", () => {
    // A truncated answer must not slip through on omission.
    const verdict = parseBusinessStoryJudgeVerdict({ pass: true, reasons: [] }, { paired: true });

    expect(verdict.business_mechanism_substantive).toBe(false);
    expect(verdict.political_geopolitical_exclusion_pass).toBe(false);
    expect(businessStoryJudgeRejectionReasons(verdict)).not.toEqual([]);
  });

  it("does not fail an unpaired story on parity it cannot judge", () => {
    const verdict = parseBusinessStoryJudgeVerdict(
      {
        pass: true,
        business_mechanism_substantive: true,
        source_support_sufficient: true,
        editorial_self_refusal: false,
        political_geopolitical_exclusion_pass: true,
        topic_promise_fit: true,
        reasons: []
      },
      { paired: false }
    );

    expect(verdict.fr_en_semantic_parity).toBe(true);
    expect(businessStoryJudgeRejectionReasons(verdict)).toEqual([]);
  });

  it("does not believe a pass that contradicts its own checks", () => {
    expect(
      businessStoryJudgeRejectionReasons({ ...PASSING, pass: true, editorial_self_refusal: true })
    ).not.toEqual([]);
  });
});
