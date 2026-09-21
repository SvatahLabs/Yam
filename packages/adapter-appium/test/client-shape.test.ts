/**
 * The hand-written client type is the one WebdriverIO actually has (REQ-ADP-5).
 *
 * `WebdriverIoBrowser` is written out rather than imported, so that this package
 * compiles and its logic is testable with no driver installed (PK-02). Nothing
 * checked the copy against the original, and it had drifted:
 * `elementSendKeys(element, text, value)` declared the old JSON Wire Protocol's
 * arity, `bindClient` passed a third argument to match, and W3C Element Send
 * Keys takes `{text}` alone. WebdriverIO answers a third argument with *"Wrong
 * parameters applied for elementSendKeys"*, so every `type` step through this
 * adapter threw — and it type-checked the whole way, because the declaration
 * the compiler was reading was the wrong one.
 *
 * The first device the adapter ever drove is what found it. Every earlier test
 * handed `bindClient` a fake that accepted whatever it was given, which is the
 * right thing for those tests and no check of this at all.
 *
 * ## Why the parameter lists, and in this direction
 *
 * `Browser extends WebdriverIoBrowser` does not catch it. A method that takes
 * fewer parameters is assignable to one that takes more — a function is allowed
 * to ignore what it is passed — so a copy that declares one argument too many
 * satisfies the original, which is precisely the drift that happened.
 *
 * So the argument lists are compared instead, and one way round: whatever the
 * copy permits, WebdriverIO has to accept. Identity would be the wrong rule —
 * `getContexts()` is declared here with no arguments and WebdriverIO takes an
 * optional one, which is a narrower copy and cannot make a call go wrong.
 *
 * Checked by this file compiling under `pnpm typecheck`; the runtime case only
 * keeps the file from being reported as empty. `webdriverio` is a devDependency
 * of this package, so the real declarations are here when the suite runs and
 * absent from what ships.
 */
import { describe, expect, it } from "vitest";
import type { Browser } from "webdriverio";
import type { WebdriverIoBrowser } from "../src/client.js";

type Params<T> = T extends (...args: infer P) => unknown ? P : never;

/** Every method whose declared arguments WebdriverIO would refuse. */
type Disagreeing = {
  [K in keyof WebdriverIoBrowser & keyof Browser]: Params<WebdriverIoBrowser[K]> extends Params<
    Browser[K]
  >
    ? never
    : K;
}[keyof WebdriverIoBrowser & keyof Browser];

/*
 * `never` when they agree. When they do not, `tsc` reports
 * `Type '"elementSendKeys"' is not assignable to type 'never'` — which names
 * the method rather than leaving a reader to find it.
 */
const NO_METHOD_DISAGREES_ABOUT_ITS_ARGUMENTS: never = undefined as unknown as Disagreeing;

describe("the structural client type matches WebdriverIO's own", () => {
  it("agrees with WebdriverIO about every method's arguments", () => {
    expect(NO_METHOD_DISAGREES_ABOUT_ITS_ARGUMENTS).toBeUndefined();
  });
});
