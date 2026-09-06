/*
 * The Java client's smoke script (T9.3, REQ-SDK-2).
 *
 *   javac -d <out> clients/java/src/main/java/com/svatah/yam/sdk/GeneratedClient.java \
 *                  clients/java/Smoke.java
 *   java -cp <out> Smoke
 *
 * T9.3's Validate: "the Python and Java clients each run one smoke script
 * against a live service (`GET /project`, `POST /run`, events) in CI."
 *
 * Three things, in that order, because they are the three shapes the service
 * has: a read, a write that starts work, and a stream that reports it. A client
 * that could do the first and not the third would pass a test that never
 * watched a run.
 *
 * `scripts/smoke-clients.mjs` starts `yam serve` and passes its url and
 * token in the environment; this compiles with `javac` alone and pulls nothing
 * from a repository, so the smoke path has no network in it.
 *
 * The JSON is read with `String.contains` and a small extractor rather than
 * with a parser, deliberately: the client has no dependencies (LLD §13.8's
 * "generated clients", REQ-PKG-3), and a smoke script that added one would be
 * testing the parser.
 */

import com.svatah.yam.sdk.GeneratedClient;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class Smoke {
  public static void main(String[] args) throws Exception {
    String url = env("YAM_SERVICE_URL");
    String token = env("YAM_SERVICE_TOKEN");
    GeneratedClient client = new GeneratedClient(url, token);

    /* 1. `GET /project` — the read every screen starts from. */
    String project = client.getProject();
    if (!project.contains("\"flows\"")) {
      fail("GET /project answered no flows: " + trim(project));
    }
    System.out.println("GET /project      " + string(project, "project") + ", " + project.length() + " bytes");

    /*
     * 2. the stream, subscribed *before* the run so nothing is missed.
     *
     * `events()` blocks on a socket, so it reads on its own thread. A script
     * that subscribed after starting the run would race the first step and pass
     * or fail by timing.
     */
    List<String> seen = new ArrayList<>();
    CountDownLatch finished = new CountDownLatch(1);
    Thread reader =
        new Thread(
            () -> {
              try {
                client
                    .events()
                    .forEach(
                        line -> {
                          synchronized (seen) {
                            seen.add(line);
                          }
                          if (line.contains("\"run.summary\"") || line.contains("\"run.failed\"")) {
                            finished.countDown();
                          }
                        });
              } catch (RuntimeException cause) {
                System.err.println("the event stream stopped: " + cause.getMessage());
                finished.countDown();
              }
            });
    reader.setDaemon(true);
    reader.start();
    Thread.sleep(500);

    /* 3. `POST /run` — a write that starts work and reports on the stream. */
    String story = System.getenv("YAM_SMOKE_STORY");
    String body = story == null ? "{}" : "{\"stories\":[\"" + story.replace("\"", "\\\"") + "\"]}";
    String started = client.postRun(body);
    String runId = string(started, "runId");
    if (runId == null) fail("POST /run answered no runId: " + trim(started));
    System.out.println("POST /run         started " + runId);

    long timeout = Long.parseLong(System.getenv().getOrDefault("YAM_SMOKE_TIMEOUT", "180"));
    if (!finished.await(timeout, TimeUnit.SECONDS)) {
      fail("no run.summary within " + timeout + " s; saw " + seen.size() + " event(s)");
    }

    long steps;
    synchronized (seen) {
      steps = seen.stream().filter(one -> one.contains("\"step.result\"")).count();
      System.out.println("GET /events/sse   " + seen.size() + " event(s), " + steps + " step result(s)");
    }
    if (steps == 0) fail("the stream carried no step.result");

    /* And the stream agreed with the files the run wrote. */
    String results = client.getRunsByIdResults(runId);
    long written = results.split("\"stepId\"", -1).length - 1;
    if (written != steps) {
      fail("the stream carried " + steps + " step(s) and results.jsonl has " + written);
    }
    System.out.println("GET /runs/" + runId + "/results  " + written + " step(s), matching the stream");

    System.out.println(
        "java " + System.getProperty("java.version") + ": 3 of 3 — the client is conformant");
  }

  private static String env(String name) {
    String value = System.getenv(name);
    if (value == null || value.isEmpty()) {
      fail(
          name
              + " is not set. Start a service with `yam serve --project <dir>` and export the "
              + "url and token it prints. The SDK never reads a model credential (LLD 13.8).");
    }
    return value;
  }

  /** `"name":"value"` out of a JSON document, without a parser. */
  private static String string(String json, String key) {
    String needle = "\"" + key + "\":";
    int at = json.indexOf(needle);
    if (at < 0) return null;
    int open = json.indexOf('"', at + needle.length());
    if (open < 0) return null;
    int close = json.indexOf('"', open + 1);
    return close < 0 ? null : json.substring(open + 1, close);
  }

  private static String trim(String text) {
    return text.length() <= 300 ? text : text.substring(0, 300) + "…";
  }

  private static void fail(String why) {
    System.err.println(why);
    System.exit(1);
  }
}
