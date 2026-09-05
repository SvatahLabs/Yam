# Compiler eval

Run at 2026-09-04T02:28:42.476Z.

Model-tier answers came from `ollama:qwen2.5:3b`.

**Overall exact match: 98.2%** (218 of 222).

Tiers covered: `tier0`, `tier1`, `tier2`. Tier 3 needs a credential.

## Per tier (REQ-COMP-9)

| Tier | Cases | Exact match | Threshold |
|---|---|---|---|
| `tier0` | 3 | 3 (100.0%) | — |
| `tier1` | 181 | 181 (100.0%) | 100% |
| `tier2` | 38 | 34 (89.5%) | 80% |

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

### `g-185` (tier 2)

> Switch to the second tab

```diff
- {
  "action": "switchWindow",
  "args": {
    "index": 1
  },
  "tier": 2
}

+ {
  "action": "switchWindow",
  "args": {
    "which": {
      "kind": "literal",
      "value": "main"
    }
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

