"""`svatah-yam` — the Python client for the Yam local service (REQ-SDK-2, LLD §13.8).

Everything that talks to a route is generated from the service's OpenAPI
description (`generated.py`); this module adds the two things a description
cannot state — where the service is, and how to read its event stream — and
nothing else.

    from svatah_yam import connect

    client = connect()                       # YAM_SERVICE_URL / _TOKEN
    project = client.get_project()
    run = client.post_run({"flows": ["flows/simple.flow"]})
    for event in client.events():
        if event["kind"] == "run.summary":
            break

Auth is the bearer token `yam serve` prints. The SDK never reads a model
credential (LLD §13.8).
"""

from __future__ import annotations

import json
import os
from typing import Optional

from .generated import (
    ENDPOINTS,
    EVENT_KINDS,
    GeneratedClient,
    ServiceConnection,
    ServiceError,
)

__all__ = [
    "ENDPOINTS",
    "EVENT_KINDS",
    "GeneratedClient",
    "ServiceConnection",
    "ServiceError",
    "YamClient",
    "connect",
]

__version__ = "0.1.0"


class YamClient(GeneratedClient):
    """The generated client. Nothing is added to it that the description states."""


def connect(url: Optional[str] = None, token: Optional[str] = None) -> YamClient:
    """Where the service is (LLD §13.8).

    `YAM_SERVICE_URL` and `YAM_SERVICE_TOKEN`, then the lock file named by
    `YAM_SERVICE_LOCK`, which is what the app writes for a service it started.
    In that order: an environment variable is what a CI job and an agent set.
    """
    resolved_url = url or os.environ.get("YAM_SERVICE_URL")
    resolved_token = token or os.environ.get("YAM_SERVICE_TOKEN")

    if resolved_url and resolved_token:
        return YamClient(ServiceConnection(resolved_url, resolved_token))

    lock_path = os.environ.get("YAM_SERVICE_LOCK")
    if lock_path and os.path.exists(lock_path):
        with open(lock_path, "r", encoding="utf-8") as handle:
            lock = json.load(handle)
        if isinstance(lock.get("url"), str) and isinstance(lock.get("token"), str):
            return YamClient(ServiceConnection(lock["url"], lock["token"]))

    raise RuntimeError(
        "No Yam service to connect to. Start one with `yam serve --project <dir>` and set "
        "YAM_SERVICE_URL and YAM_SERVICE_TOKEN to the url and token it prints. "
        "The SDK never reads a model credential (LLD 13.8)."
    )
