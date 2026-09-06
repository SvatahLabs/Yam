# @svatah/yam-bindings

Module (a)'s core (REQ-PKG-1): the bindings store, the context hash, the resolver,
candidate synthesis, fingerprinting, and model-free relocalization.

It depends on `@svatah/yam-surface` and `@svatah/yam-schema` and on nothing else — not on
the flow language, not on the compiler, not on the model gateway. That is the
whole point of the module: a Playwright user adopts it without adopting anything
else. The import-boundary lint and the dependency-graph test in
`tools/repo-checks` hold it to that (LLD §1).

## The store (LLD §6.1)

`bindings/<app>/<page>/<element>.yaml`, canonical YAML, one file per element. An
id is the same path written with dots — `login.username-field` is
`bindings/login/username-field.yaml` — so the layout is readable from an id and
an id is readable from a path.

Writing the same bindings twice produces the same bytes, and `save()` does not
touch a file whose content is unchanged. That is what makes a re-record a
reviewable diff rather than noise (REQ-REC-9).

## The context hash (LLD §6.2)

Computed from the surface snapshot rather than the DOM, so it is adapter-neutral:
the nearest landmark, `form`, `dialog` or `window` ancestor, rendered with names
replaced by length buckets, sha256.

It ignores what a page *says* and tracks what a page *is*. A greeting with a
different user's name in it is not a shape change; a wrapper element, a reordered
sidebar or a moved form is. Two uses follow from that: bindings are scoped by it
(REQ-REC-6), and a failed resolution can say whether the element moved or the page
changed (LLD §6.3).

## The resolver (LLD §6.3, REQ-RUN-5)

Candidates in the order they are stored, each with its own timeout, requiring
**exactly one** match. A candidate that matches two elements is not a near miss —
it cannot say which element was meant, and taking the first would make replay
depend on document order. `nth` is how a candidate that legitimately matches
several says which.

A `webmcp` candidate is preferred over the locators when the adapter reports the
capability and the site still declares the tool, and falls through to them when
it does not (REQ-ADP-9).

`LocatorError` reports every candidate tried, what each one saw, where the session
was, and whether the page's shape had drifted from the one the binding was
recorded against. It is the input the healer works from (REQ-HEAL-1) and the thing
a person reads in a CI log, so it says all of that rather than "element not
found".

## Licence

Apache-2.0.
