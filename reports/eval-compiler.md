# Compiler eval

Run at 2026-09-06T21:10:26.636Z.

Model-tier answers came from `ollama:qwen2.5:3b`.

**Overall exact match: 98.0%** (297 of 303).

Tiers covered: `tier0`, `tier1`, `tier2`. Tier 3 needs a credential.

## Per tier (REQ-COMP-9)

| Tier | Cases | Exact match | Threshold |
|---|---|---|---|
| `tier0` | 3 | 3 (100.0%) | — |
| `tier1` | 250 | 250 (100.0%) | 100% |
| `tier2` | 50 | 44 (88.0%) | 80% |

## Method

Every entry in `evals/compiler/golden.jsonl` is compiled on its own, with a fresh target
dictionary, so no entry's phrases can bind another's. A `tier: 1` entry goes through the
grammar; a `tier: 2` entry is a sentence the grammar deliberately refuses, and is offered
to the local model; a `tier: 3` entry is offered to the frontier model.

A case matches when the compiled step is **byte-identical** to the expected one on the
part the sentence determines: action, target phrase, arguments, expectation, capture and
originating tier. The step id, the line, the timeout and the provenance are not compared —
the first three come from the project rather than the sentence, and the fourth is
different on every run by construction.

## Not matched

### `g-161` (tier 2)

> Push the book now button

```diff
- {
  "action": "click",
  "target": {
    "phrase": "the book now button",
    "ref": "book-now-button",
    "status": "unbound"
  },
  "tier": 2
}

+ {
  "action": "press",
  "args": {
    "key": {
      "kind": "literal",
      "value": "Enter"
    }
  },
  "tier": 2
}

```

### `g-183` (tier 2)

> Confirm the alert

```diff
- {
  "action": "dialog",
  "args": {
    "action": {
      "kind": "literal",
      "value": "accept"
    }
  },
  "tier": 2
}

+ {
  "action": "expect",
  "expect": {
    "predicate": {
      "kind": "present"
    },
    "subject": "target"
  },
  "target": {
    "phrase": "the alert",
    "ref": "alert",
    "status": "unbound"
  },
  "tier": 2
}

```

### `g-190` (tier 2)

> The address bar should end up at "/dashboard"

```diff
- {
  "action": "expect",
  "expect": {
    "predicate": {
      "kind": "urlContains",
      "value": {
        "kind": "literal",
        "value": "/dashboard"
      }
    },
    "subject": "page"
  },
  "tier": 2
}

+ {
  "action": "expect",
  "expect": {
    "predicate": {
      "kind": "urlContains",
      "value": {
        "kind": "literal",
        "value": "/dashboard"
      }
    },
    "subject": "page"
  },
  "target": {
    "phrase": "the address bar",
    "ref": "address-bar",
    "status": "unbound"
  },
  "tier": 2
}

```

### `g-192` (tier 2)

> Grab a screenshot called "after-login"

```diff
- {
  "action": "screenshot",
  "args": {
    "name": {
      "kind": "literal",
      "value": "after-login"
    }
  },
  "tier": 2
}

+ {
  "action": "screenshot",
  "tier": 2
}

```

### `g-301` (tier 2)

> Save a screenshot under "checkout"

```diff
- {
  "action": "screenshot",
  "args": {
    "name": {
      "kind": "literal",
      "value": "checkout"
    }
  },
  "tier": 2
}

+ {
  "action": "screenshot",
  "capture": {
    "from": "result",
    "name": "checkout"
  },
  "tier": 2
}

```

### `g-303` (tier 2)

> Fire the "active count" API and keep the response as activeCount

```diff
- {
  "action": "api",
  "args": {
    "name": {
      "kind": "literal",
      "value": "active count"
    }
  },
  "capture": {
    "from": "response",
    "name": "activeCount"
  },
  "tier": 2
}

+ {
  "action": "api",
  "args": {
    "request": {
      "kind": "literal",
      "value": "active count"
    }
  },
  "capture": {
    "from": "response",
    "name": "activeCount"
  },
  "tier": 2
}

```

