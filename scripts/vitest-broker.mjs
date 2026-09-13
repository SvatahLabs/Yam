/**
 * A broker that dies with the run that started it.
 *
 * `YAM_BROKER_STATE_DIR` gives each package's suite a broker of its own, which
 * is what stops one suite closing another's sessions. On its own it trades one
 * problem for a smaller one: the broker's idle timeout is fifteen minutes, so
 * running the suite repeatedly leaves a broker per run alive on the machine —
 * ten runs in an afternoon is ten node processes, each holding a port.
 *
 * A `globalSetup` teardown is the right hook: it runs once per package's suite,
 * after every worker has finished.
 *
 * It reads the directory from `process.env`, which the config sets **on the
 * process** and not only in `test.env`. That distinction is the whole of a
 * false start: `test.env` reaches the workers, `globalSetup` runs in the main
 * process, and the first version of this armed on every suite and read
 * `undefined` every time — cleaning nothing while appearing to work.
 *
 * It reads the descriptor rather than matching on a command line. `pkill -f
 * "surface broker"` would kill *every* broker on the machine, including the one
 * a person has open in another terminal, which is the kind of test cleanup that
 * makes people stop running tests.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export default function setup() {
  const dir = process.env["YAM_BROKER_STATE_DIR"];
  return () => {
    if (dir === undefined || dir.trim() === "") return;
    let pid;
    try {
      pid = JSON.parse(readFileSync(join(dir, "broker.json"), "utf8")).pid;
    } catch {
      /* No broker was ever started here, which is the common case. */
    }
    if (typeof pid === "number") {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* Already gone. */
      }
    }
    rmSync(dir, { recursive: true, force: true });
  };
}
