Bindings — an element named once, in a file

A binding lives at bindings/<app>/<page>/<element>.yaml and carries a ranked
list of candidates (a test id, an id, a role and name, a label, a CSS path…)
plus a structural fingerprint. The resolver tries the candidates in order and
accepts one only when it matches exactly one element. The fingerprint is used
only when every candidate fails: healing scores every element on the page
against it, and a clear winner is proposed, never silently applied.

Three ways a binding comes to exist:

  yam record                 drive the plan; click each unbound element, or let a
                             model gateway ground it; review, then it is written
  YAM_MODE=record            the same, from a plain Playwright test using bind()
  yam heal                   propose a repair for a binding that stopped resolving

Reading the store:

  yam bindings list          every binding and its phrases
  yam bindings show <id>     one binding in full
  yam bindings verify        resolve every binding live, act on nothing
  yam bindings prune         find bindings nothing names any more

A run that only passed because a binding was healed exits 6, not 0. The
repair is a diff under .yam/ for a person to read; --apply writes it.
