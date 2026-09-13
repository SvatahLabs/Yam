# @svatah/yam-contract

The surface operation catalogue, and the fingerprint every Yam client checks
before it will talk to a broker.

This package describes the contract. It does not implement it and it drives
nothing: its only dependencies are `@svatah/yam-schema` and `zod`.

`@svatah/yam`, `@svatah/yam-mcp` and Yam.app all depend on it, so a contract
change is one version bump that all three observe rather than three packages
that drifted.
