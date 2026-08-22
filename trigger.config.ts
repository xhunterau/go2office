import { defineConfig } from "@trigger.dev/sdk"

export default defineConfig({
  // The literal ref rather than process.env.TRIGGER_PROJECT_REF. This file is
  // evaluated by the CLI before it hydrates a task's environment, and an
  // undefined project fails with a message that points at the config rather
  // than at the missing variable. The ref is not a secret -- it is the id in
  // the dashboard URL. It is NOT the slug (`go2office-7Yzy`); the two are not
  // interchangeable.
  project: "proj_wwabgtzjdqddykvvvpxx",
  runtime: "node-24",
  dirs: ["./src/trigger"],
  // A quote batch is a handful of Supabase round trips plus one live Aramex
  // call. 120s is generous; the task sets its own tighter ceiling.
  maxDuration: 120,
  retries: {
    // A failed quote in development should surface immediately rather than be
    // retried behind your back while you are reading the logs.
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
})
