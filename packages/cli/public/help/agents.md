Agents — the same plan, called by something that is not a person

  yam tool serve --expose "Story one,Story two"
      An MCP server whose tools are the stories. Each tool's input schema is
      the story's signature; each call is a run with the agent recorded as the
      invoker. A story not marked idempotent is not listed in production.

  yam explore
      The agent writes the first draft. Point an MCP host at `yam explore
      <project>` as its server; the agent explores through the raw surface,
      saying what it is trying to do at each call, and when it disconnects
      the exploration is compiled into a proposal under proposals/<date>/
      for you to review. `yam` then names it as the next thing to do.

  yam mcp
      The operations and the raw surface (snapshot, act, read, check) over
      stdio, for an agent that explores. Every call is recorded as a
      trajectory; yam trajectory compile turns one into a proposal under
      proposals/ for a person to read.

  yam workflow run <story> --input k=v
      One story as a function, outputs on stdout as JSON; what a scheduler or
      a script calls.

Replay never calls a model: what a model decided, it decided at authoring
time and it is in the files. The audit line in runs/<id>/audit.jsonl is the
only account of why the system changed.
