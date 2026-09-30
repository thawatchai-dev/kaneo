import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vite-plus/test";

function renderBundle(bundle: string, key = "") {
  return execFileSync(
    "awk",
    ["-f", resolve(import.meta.dirname, "../env.awk")],
    {
      input: bundle,
      encoding: "utf8",
      env: {
        ...process.env,
        KANEO_TURNSTILE_SITE_KEY: key,
        KANEO_API_URL: "https://api.example.test",
        KANEO_CLIENT_URL: "https://app.example.test",
      },
    },
  );
}
describe("runtime environment replacement", () => {
  it("clears unset optional placeholders for every emitted literal quote", () => {
    const rendered = renderBundle(
      "globalThis.values = [\"KANEO_TURNSTILE_SITE_KEY\", 'KANEO_TURNSTILE_SITE_KEY', `KANEO_TURNSTILE_SITE_KEY`, 'https://example.test'];",
    );
    const context: { values?: string[] } = {};
    runInNewContext(rendered, context);
    expect(context.values).toEqual(["", "", "", "https://example.test"]);
  });
  it("renders KANEO_WS_URL as its value, or an empty string when unset", () => {
    const bundle = 'globalThis.ws = "KANEO_WS_URL";';
    const run = (wsUrl?: string) => {
      const context: { ws?: string } = {};
      const env = { ...process.env, KANEO_WS_URL: wsUrl };
      if (wsUrl === undefined) delete env.KANEO_WS_URL;
      runInNewContext(
        execFileSync(
          "awk",
          ["-f", resolve(import.meta.dirname, "../env.awk")],
          {
            input: bundle,
            encoding: "utf8",
            env,
          },
        ),
        context,
      );
      return context.ws;
    };
    expect(run("wss://app.example.test/ws")).toBe("wss://app.example.test/ws");
    expect(run()).toBe("");
  });
  it("encodes configured punctuation as literal data rather than JavaScript", () => {
    const key = '";globalThis.injected=true;//\\\n`';
    const context: { value?: string; injected?: boolean } = {};
    runInNewContext(
      renderBundle('globalThis.value = "KANEO_TURNSTILE_SITE_KEY";', key),
      context,
    );
    expect(context.value).toBe(key);
    expect(context.injected).toBeUndefined();
  });
});
