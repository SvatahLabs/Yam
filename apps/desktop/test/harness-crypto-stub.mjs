export function createHash() { return { update() { return this; }, digest() { return "stub"; } }; }
export default { createHash };
