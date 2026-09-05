import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getLearningCopy } from "./learningCopy";

/**
 * Opening a session should feel like opening the card you just tapped.
 *
 * The Path tab's session card leads with a compass, the domain, then "Session
 * N". The session screen used to lead with a generic "Learning path" eyebrow
 * and push the domain into a smaller caption underneath — so the first line
 * changed between the tap and the arrival, which is exactly where recognition
 * is lost. It now opens on the same three things, and answers "where am I" on
 * the line that used to say only the session number.
 *
 * No shared-element transition, no animated layout: the continuity is that the
 * two screens say the same thing in the same order.
 */

const sessionScreen = readFileSync(
  join(__dirname, "LearningSessionScreen.tsx"),
  "utf8"
);
const pathScreen = readFileSync(
  join(__dirname, "..", "modules", "PathModuleScreen.tsx"),
  "utf8"
);

describe("the session screen inherits the tapped card's identity", () => {
  it("opens on the same compass and domain the card led with", () => {
    for (const source of [pathScreen, sessionScreen]) {
      expect(source).toContain('name="compass"');
      expect(source).toContain("localizeLearningField(");
    }

    expect(sessionScreen).toContain("displayDomain");
  });

  it("no longer leads with the generic eyebrow that the card never showed", () => {
    // Only the header is in scope: the "session unavailable" card still opens
    // on the generic eyebrow, correctly — there is no session to name there.
    const header = sessionScreen.slice(
      sessionScreen.indexOf("<View style={styles.header}>"),
      sessionScreen.indexOf("copy.objectives")
    );

    expect(header).toContain("displayDomain");
    // The generic label survives in the header only as the fallback for a path
    // that has no domain to show.
    expect(header).toContain(": copy.eyebrow");
    expect(header).not.toContain("<AppText variant=\"eyebrow\">{copy.eyebrow}</AppText>");
  });

  it("drops the duplicate domain·objective caption rather than adding a line", () => {
    expect(sessionScreen).not.toContain("displayObjective");
  });

  it("carries the session title and summary from the session itself", () => {
    expect(sessionScreen).toContain("localizeSessionTitle(session");
    expect(sessionScreen).toContain("localizeSessionSummary(session");
  });

  it("states where the reader is in the path", () => {
    expect(sessionScreen).toContain("copy.sessionPosition(");
    expect(sessionScreen).toContain("completedSessionCount");
  });

  it("counts completion the same way the Path tab does", () => {
    for (const source of [pathScreen, sessionScreen]) {
      expect(source).toContain('status === "completed"');
      expect(source).toContain("completed_at");
    }
  });
});

describe("session position copy", () => {
  it("names the session, and the path position once there is one", () => {
    const en = getLearningCopy("en").session;

    expect(en.sessionPosition(3, 2)).toBe("Session 3 · 2 completed");
    // Nothing completed yet: no empty "0 completed" to read past.
    expect(en.sessionPosition(1, 0)).toBe("Session 1");
  });

  it("agrees in number in French", () => {
    const fr = getLearningCopy("fr").session;

    expect(fr.sessionPosition(3, 2)).toBe("Session 3 · 2 terminées");
    expect(fr.sessionPosition(2, 1)).toBe("Session 2 · 1 terminée");
    expect(fr.sessionPosition(1, 0)).toBe("Session 1");
  });

  it("switches language with the reader", () => {
    expect(getLearningCopy("fr").session.sessionPosition(3, 2)).not.toBe(
      getLearningCopy("en").session.sessionPosition(3, 2)
    );
  });
});

describe("navigation is left alone", () => {
  it("adds no custom transition to fight the native stack", () => {
    for (const source of [pathScreen, sessionScreen]) {
      expect(source).not.toContain("Animated");
      expect(source).not.toContain("sharedTransition");
    }
  });
});
