#!/usr/bin/env python3
"""The Python client's smoke script (T9.3, REQ-SDK-2).

    python3 clients/python/smoke.py

T9.3's Validate: "the Python and Java clients each run one smoke script against
a live service (`GET /project`, `POST /run`, events) in CI."

Three things, in that order, because they are the three shapes the service has:
a read, a write that starts work, and a stream that reports it. A client that
could do the first and not the third would pass a test that never watched a run.

The service is `yam serve` and is started by
`scripts/smoke-clients.mjs`, which passes its url and token in the environment;
this script does not start anything, so it is also what a person runs by hand
against a service they already have open.

Exit 0 when all three worked, 1 when one did not, with the reason on stderr.
"""

from __future__ import annotations

import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from svatah_yam import ServiceError, connect  # noqa: E402

TIMEOUT_SECONDS = float(os.environ.get("YAM_SMOKE_TIMEOUT", "180"))


def main() -> int:
    client = connect()

    # 1. `GET /project` — the read every screen starts from.
    project = client.get_project()
    name = project.get("config", {}).get("project")
    flows = project.get("flows", [])
    stories = project.get("stories", [])
    if not isinstance(flows, list) or len(flows) == 0:
        print(f"GET /project answered no flows: {project!r}", file=sys.stderr)
        return 1
    print(f"GET /project      {name}: {len(flows)} flow(s), {len(stories)} story/stories")

    # 2. the stream, subscribed *before* the run so nothing is missed.
    #
    # `client.events()` blocks on a socket, so it runs on its own thread and
    # posts what it saw into a list. A script that subscribed after starting the
    # run would race the first step and pass or fail by timing.
    seen: list[dict] = []
    finished = threading.Event()

    def read_events() -> None:
        try:
            for event in client.events():
                seen.append(event)
                if event.get("kind") in ("run.summary", "run.failed"):
                    finished.set()
                    return
        except Exception as error:  # noqa: BLE001 - reported below, never raised here
            print(f"the event stream stopped: {error}", file=sys.stderr)
            finished.set()

    reader = threading.Thread(target=read_events, daemon=True)
    reader.start()
    time.sleep(0.5)

    # 3. `POST /run` — a write that starts work and reports on the stream.
    story = os.environ.get("YAM_SMOKE_STORY")
    body = {"stories": [story]} if story else {}
    try:
        started = client.post_run(body)
    except ServiceError as error:
        print(f"POST /run refused: {error}", file=sys.stderr)
        return 1
    run_id = started.get("runId")
    if not isinstance(run_id, str):
        print(f"POST /run answered no runId: {started!r}", file=sys.stderr)
        return 1
    print(f"POST /run         started {run_id}")

    if not finished.wait(TIMEOUT_SECONDS):
        print(
            f"no run.summary within {TIMEOUT_SECONDS:.0f} s; saw "
            f"{[one.get('kind') for one in seen]}",
            file=sys.stderr,
        )
        return 1

    kinds = [one.get("kind") for one in seen]
    steps = [one for one in seen if one.get("kind") == "step.result"]
    print(f"GET /events/sse   {len(seen)} event(s): {', '.join(dict.fromkeys(kinds))}")

    if "step.result" not in kinds:
        print("the stream carried no step.result", file=sys.stderr)
        return 1

    # And the stream agreed with the files: `GET /runs/:id/results` is what the
    # run wrote, and the events are what it said while writing them.
    results = client.get_runs_by_id_results(run_id)
    if len(results) != len(steps):
        print(
            f"the stream carried {len(steps)} step(s) and results.jsonl has {len(results)}",
            file=sys.stderr,
        )
        return 1
    print(f"GET /runs/{run_id}/results  {len(results)} step(s), matching the stream")

    print(f"python {sys.version.split()[0]}: 3 of 3 — the client is conformant")
    return 0


if __name__ == "__main__":
    sys.exit(main())
