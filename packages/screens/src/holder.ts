/**
 * How this desktop names itself when it takes a target (SF-13, T16).
 *
 * A holder is a name a person reads beside a session — "You control" in the
 * app, "Yam desktop controls" in the agent's terminal — so it is a word rather
 * than an opaque id, and it is one constant so the two never disagree.
 *
 * It lives in a module of its own because both the action registry (which sends
 * it) and the Surfaces screen (which compares against it) need it, and the
 * screen already imports the registry: putting it in either would make the
 * dependency circular.
 */
export const DESKTOP_HOLDER = "Yam desktop";
