import { describe, expect, it } from "vitest";

import type { Language, RankedArticle, TopicId } from "../domain.js";
import { assessBusinessStorySourceRichness } from "./businessStoryRichness.js";
import { allocateBusinessStorySourcePackets } from "./sourceEventAllocation.js";

/**
 * True and recent is not enough to make a Business Story.
 *
 * The launch catalog contains a story built on an ISS antenna deployment that
 * spends most of its length listing what the source does not say: no cost, no
 * company, no contract, no margin, no competitive mechanism, no commercial
 * outcome. The grounding rules worked perfectly — the story invented none of it
 * — and the item is still unreadable.
 *
 * Being cautious is right. Choosing an event that cannot support a business
 * story is not, and that decision belongs before generation rather than in the
 * prose.
 */

function article(input: {
  url: string;
  title: string;
  summary: string;
  body: string;
  topic?: TopicId;
  language?: Language;
}): RankedArticle {
  return {
    url: input.url,
    title: input.title,
    publisher: "Desk",
    author: null,
    published_at: "2026-08-20T08:00:00.000Z",
    retrieved_at: "2026-08-20T09:00:00.000Z",
    language: input.language ?? "en",
    summary: input.summary,
    body: input.body,
    sourceTopic: input.topic ?? "business",
    credibility_score: 0.9,
    content_hash: input.url,
    normalized_url: input.url,
    topic: input.topic ?? "business",
    importance_score: 0.9,
    rank_reasons: ["test"]
  };
}

/** The real failure: an announcement with nothing commercial behind it. */
const ISS_ANTENNA = article({
  url: "https://space.test/iss-antenna",
  title: "New antenna deployed on the International Space Station",
  topic: "engineering",
  summary:
    "Astronauts installed a new communications antenna during a spacewalk outside the International Space Station this week.",
  body:
    "The antenna was carried up on the previous resupply flight and installed during a six-hour spacewalk. It replaces an older unit that had been in service since the module was first pressurised. Engineers on the ground confirmed the link was established and that telemetry was flowing normally. The agency said the installation went as planned and that further activity outside the station is scheduled for later in the year. No further technical detail about the hardware was released."
});

const COTTI_COFFEE = article({
  url: "https://retail.test/cotti-coffee",
  title: "Cotti Coffee pushes its discount pricing into new markets",
  summary:
    "The chain is holding drinks near 9.9 yuan while opening franchised stores at speed, betting that volume covers the thinner margin.",
  body:
    "Cotti has opened more than 6000 stores in under two years, most of them franchised, which keeps its own capital expenditure down and pushes the fit-out cost onto partners. The pricing sits well below the incumbent, and the company is subsidising part of the discount to hold the price point while it builds density. Supply chain scale is the stated route to making the unit economics work: at current volumes the cost per cup falls enough that franchisees can still clear a margin. The risk is that a competitor matches the price before that density arrives."
});

const AI_BY_API = article({
  url: "https://tech.test/ai-by-api",
  title: "Model provider cuts inference pricing for high-volume API customers",
  topic: "tech_ai",
  summary:
    "The provider dropped per-token pricing by 40% for customers above a committed monthly volume, tying the discount to capacity reservations.",
  body:
    "The new rate card charges less per token once a customer commits to a monthly spend, which lets the provider plan capacity against reserved demand rather than spot traffic. Utilisation of the fleet is the constraint: idle accelerators cost the same as busy ones, so a committed customer that smooths the load is worth more than a larger one that spikes. Competitors have matched parts of the move. Customers gain a lower unit cost but take on switching costs, because the committed volume is tied to one provider's stack."
});

describe("a source packet has to be able to carry a business story", () => {
  it("refuses the ISS antenna announcement", () => {
    const richness = assessBusinessStorySourceRichness({ articles: [ISS_ANTENNA] });

    expect(richness.assessable).toBe(true);
    expect(richness.sufficient).toBe(false);
    // Not because it is short or false — because there is no business mechanism
    // in it to write about.
    expect(richness.mechanisms.length).toBeLessThan(2);
  });

  it("accepts the Cotti Coffee packet", () => {
    const richness = assessBusinessStorySourceRichness({ articles: [COTTI_COFFEE] });

    expect(richness.sufficient).toBe(true);
    expect(richness.mechanisms).toEqual(expect.arrayContaining(["pricing", "unit_economics"]));
    expect(richness.hasFigures).toBe(true);
  });

  it("accepts the AI-by-API packet", () => {
    const richness = assessBusinessStorySourceRichness({ articles: [AI_BY_API] });

    expect(richness.sufficient).toBe(true);
    expect(richness.mechanisms).toEqual(expect.arrayContaining(["pricing"]));
  });

  it("lets a supporting source rescue a thin announcement about the same event", () => {
    const contract = article({
      url: "https://space.test/iss-antenna-contract",
      title: "Agency contract for the station antenna runs to 40 million euros",
      topic: "engineering",
      summary:
        "The prime contractor holds a 40 million euro contract covering the antenna and two spares, with penalties tied to delivery dates.",
      body:
        "The contract was awarded after a competitive tender in which two suppliers bid. It covers the flight unit and two spares, and the payment schedule is tied to delivery milestones with penalties for slippage. The contractor said the programme carries a thin margin and that it took the work partly to keep its production line loaded between larger orders."
    });

    expect(assessBusinessStorySourceRichness({ articles: [ISS_ANTENNA] }).sufficient).toBe(false);
    // The packet, not the primary alone, is what gets judged — which is the
    // reason supporting sources exist at all.
    expect(
      assessBusinessStorySourceRichness({ articles: [ISS_ANTENNA, contract] }).sufficient
    ).toBe(true);
  });

  it("reports a packet too terse to judge as ambiguous, not as a pass", () => {
    const terse = article({
      url: "https://wire.test/terse",
      title: "Firm names a new chief executive",
      summary: "Short wire item.",
      body: ""
    });
    const richness = assessBusinessStorySourceRichness({ articles: [terse] });

    // This used to count as a pass, on the reasoning that absence of evidence is
    // not evidence of absence. For Business Story selection that is backwards:
    // the information the format needs is exactly the information missing, and
    // it is how "les abonnements sont visibles, pas encore le mécanisme" came to
    // be written. The verdict is reported; the caller decides.
    expect(richness.assessable).toBe(false);
    expect(richness.verdict).toBe("ambiguous");
    expect(richness.sufficient).toBe(false);
  });

  it("keeps a terse event out of the allocation unless it is explicitly allowed", () => {
    const terse = article({
      url: "https://wire.test/terse-2",
      title: "Firm names a new chief executive",
      summary: "Short wire item.",
      body: ""
    });

    expect(
      allocateBusinessStorySourcePackets({ articles: [terse], topics: ["business"] })
    ).toEqual([]);

    // The old lenient behaviour stays reachable, for a caller that has already
    // had the ambiguous packets looked at.
    expect(
      allocateBusinessStorySourcePackets({
        articles: [terse],
        topics: ["business"],
        allowAmbiguousPackets: true
      }).map((packet) => packet.primary.url)
    ).toEqual([terse.url]);
  });
});

describe("the gate runs where the event is chosen", () => {
  it("keeps a thin event out of the Business Story allocation entirely", () => {
    const packets = allocateBusinessStorySourcePackets({
      articles: [ISS_ANTENNA, COTTI_COFFEE, AI_BY_API],
      topics: ["business", "finance", "tech_ai", "engineering"]
    });

    expect(packets.map((packet) => packet.primary.url)).toEqual([
      COTTI_COFFEE.url,
      AI_BY_API.url
    ]);
  });

  it("does not apply it to Mini Case batches", () => {
    // A case tests a decision. A source too thin to carry a story can still
    // frame one, so the same event stays available here.
    const packets = allocateBusinessStorySourcePackets({
      articles: [ISS_ANTENNA],
      topics: ["engineering"],
      requireBusinessMechanism: false
    });

    expect(packets.map((packet) => packet.primary.url)).toEqual([ISS_ANTENNA.url]);
  });
});
