# Compiler eval

Run at 2026-09-03T19:31:12.184Z.

Model-tier answers came from `ollama:qwen2.5:3b`.

**Overall exact match: 97.9%** (188 of 192).

## Per tier (REQ-COMP-9)

| Tier | Cases | Exact match | Threshold |
|---|---|---|---|
| `tier0` | 3 | 3 (100.0%) | — |
| `tier1` | 148 | 148 (100.0%) | 100% |
| `tier2` | 41 | 37 (90.2%) | 80% |

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

### `g-153` (tier 2)

> Browse to "https://sample.test/dashboard"

```diff
- {
  "action": "navigate",
  "args": {
    "url": {
      "kind": "literal",
      "value": "https://sample.test/dashboard"
    }
  },
  "tier": 2
}

+ {
  "action": "navigate",
  "args": {
    "url": {
      "kind": "literal",
      "value": "https://sample.test/dashboard"
    }
  },
  "expect": {
    "predicate": {
      "kind": "url",
      "value": {
        "kind": "literal",
        "value": "https://sample.test/dashboard"
      }
    },
    "subject": "page"
  },
  "tier": 2
}

```

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

### `g-188` (tier 2)

> Ensure the booking result reads "confirmed"

```diff
- {
  "action": "expect",
  "expect": {
    "predicate": {
      "kind": "text",
      "value": {
        "kind": "literal",
        "value": "confirmed"
      }
    },
    "subject": "target"
  },
  "target": {
    "phrase": "the booking result",
    "ref": "booking-result",
    "status": "unbound"
  },
  "tier": 2
}

+ {
  "action": "expect",
  "args": {
    "value": {
      "kind": "literal",
      "value": "confirmed"
    }
  },
  "target": {
    "phrase": "the booking result",
    "ref": "booking-result",
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

