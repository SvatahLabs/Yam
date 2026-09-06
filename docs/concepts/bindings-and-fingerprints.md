# Bindings and fingerprints

A binding names an element once, in a file, so that neither the flow nor the
test contains a selector.

## The store

`bindings/<app>/<page>/<element>.yaml`, canonical YAML, one file per element,
committed and reviewed like code. A dictionary maps the phrases a flow uses to
element ids, built from the parsed files and never by scanning text. A context
hash, computed from the snapshot rather than the DOM so it is the same on every
adapter, records the shape of the region the element was recorded in.

## Candidates, and the exactly-one rule

Each binding carries a ranked bundle of candidates: a test id, an id, a role
and name, a label, a placeholder, an anchored CSS path, a relative XPath, or on
other platforms an automation id, a resource id, a control path. The resolver
tries them in order and accepts a candidate only when it identifies exactly one
element. Many matches are not a match. When nothing resolves the failure names
every candidate tried, what each matched, and whether the context hash drifted.

## The fingerprint

Beside the candidates is a structural fingerprint from `describe()`: role,
name, attributes, the names of the neighbours, the role path from the root,
and the box. It is never used to find an element during a normal run. It exists
for the moment every candidate fails.

## Relocalization, without a model

Healing scores every element now on the page against the fingerprint:

```
0.30 · attribute Jaccard + 0.25 · text similarity + 0.20 · neighbour similarity
+ 0.15 · role-path similarity + 0.10 · box proximity
```

A proposal is accepted when the best score is above the threshold (default
0.72) and clear of the runner-up by the margin (default 0.10). Because it
operates on the surface's `describe()` output, the same scoring heals a
binding on a web page, a native window or a mobile screen. The published number
is 92.3 percent of degraded bindings recovered over twenty deliberate interface
changes, with zero repairs onto the wrong element; the method is in
[`reports/eval-healing.md`](../../reports/eval-healing.md).

## Where a model fits

Nowhere in the store's normal life. A model may ground a phrase at record time
and may be asked to re-ground during a heal, and each time the result is a file
with provenance that a person reviews. The four packages of module (a),
bindings, healer, the Playwright fixture and the bindings CLI, depend on no
model gateway at all.
