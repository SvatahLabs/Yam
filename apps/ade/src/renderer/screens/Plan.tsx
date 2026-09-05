/**
 * The Plan screen (T3.7, REQ-ADE-3, LLD §13.6).
 *
 * "Plan (`POST /compile` result per story: step, tier, confidence, target
 * status)."
 *
 * What a prose flow became. Reading it is how a person finds out that a sentence
 * they meant one way compiled another — a step that came from Tier 2 rather than
 * the grammar, a confidence the compiler is not sure about, a target still
 * `unbound` because nothing has recorded it yet.
 *
 * The unbound targets are the ones worth acting on: each is a `svatah record`
 * away from working, and a plan with none is a plan that will replay.
 */
import { useEffect, useState } from "react";
import { fromEndpoint, type ScreenData, type ServiceClient } from "../client.js";

interface PlanStep {
  id: string;
  line: number;
  text: string;
  action: string;
  tier: number;
  confidence: number;
  target?: { ref: string; phrase: string; status: string };
  target2?: { ref: string; phrase: string; status: string };
}

interface PlanStory {
  name: string;
  file: string;
  steps: PlanStep[];
}

interface Plan {
  hash: string;
  stories: PlanStory[];
}

export function PlanScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [plan, setPlan] = useState<ScreenData<Plan> | undefined>(undefined);
  const [story, setStory] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setError(undefined);
    void client
      .getPlan()
      .then((value) => {
        const compiled = value as Plan;
        setPlan(fromEndpoint("getPlan", compiled));
        setStory((current) => current ?? compiled.stories[0]?.name);
      })
      .catch((cause: unknown) => setError(String(cause)));
  }, [client]);

  if (error !== undefined) {
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  }
  if (plan === undefined) return <p className="muted">Compiling…</p>;

  const current = plan.value.stories.find((one) => one.name === story) ?? plan.value.stories[0];
  const unbound = plan.value.stories.flatMap((one) =>
    one.steps.flatMap((step) =>
      [step.target, step.target2].filter(
        (target): target is NonNullable<typeof target> => target?.status === "unbound",
      ),
    ),
  );

  return (
    <section aria-label="Plan">
      <div className="row">
        <label htmlFor="plan-story">Story</label>
        <select
          id="plan-story"
          value={current?.name ?? ""}
          onChange={(event) => setStory(event.target.value)}
          style={{ width: "auto" }}
        >
          {plan.value.stories.map((one) => (
            <option key={one.name} value={one.name}>
              {one.name}
            </option>
          ))}
        </select>
        <span className="muted">plan {plan.value.hash.slice(0, 12)}</span>
      </div>

      {unbound.length > 0 ? (
        <p className="muted">
          {unbound.length} target(s) are still <strong>unbound</strong> across this plan. Each is a{" "}
          <code>svatah record</code> away from resolving:{" "}
          {[...new Set(unbound.map((one) => one.phrase))].slice(0, 6).join(", ")}
          {unbound.length > 6 ? " …" : ""}
        </p>
      ) : null}

      {current === undefined ? (
        <p className="muted">This plan has no stories.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Line</th>
              <th>Step</th>
              <th>Action</th>
              <th>Tier</th>
              <th>Confidence</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {current.steps.map((step) => (
              <tr key={step.id}>
                <td>{step.line}</td>
                <td>{step.text}</td>
                <td>{step.action}</td>
                <td>{step.tier}</td>
                <td className={step.confidence < 0.8 ? "failed" : ""}>
                  {step.confidence.toFixed(2)}
                </td>
                <td className={step.target?.status === "unbound" ? "failed" : ""}>
                  {step.target === undefined
                    ? ""
                    : `${step.target.ref} (${step.target.status})`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="source">Rendered from {plan.from}.</p>
    </section>
  );
}
