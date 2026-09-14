import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const placeholderPattern =
  "[`\\\"'](KANEO_TURNSTILE_SITE_KEY|KANEO_WS_URL)[`\\\"']";
const turnstilePlaceholder = "KANEO_TURNSTILE_SITE_KEY";
const wsUrlPlaceholder = "KANEO_WS_URL";

describe("runtime environment replacement", () => {
  it("strips unset placeholders regardless of the quote emitted by the bundler", () => {
    const bundle = [
      `const doubleQuoted = "${turnstilePlaceholder}";`,
      `const singleQuoted = '${turnstilePlaceholder}';`,
      `const templateLiteral = \`${turnstilePlaceholder}\`;`,
      `const wsUrl = "${wsUrlPlaceholder}";`,
      `const required = "KANEO_API_URL";`,
      `const configured = "https://example.com";`,
    ].join("\n");

    const result = execFileSync("sed", ["-E", `s#${placeholderPattern}#""#g`], {
      input: bundle,
      encoding: "utf8",
    });

    expect(result).not.toContain("KANEO_TURNSTILE_SITE_KEY");
    expect(result).not.toContain("KANEO_WS_URL");
    expect(result).toContain(`const required = "KANEO_API_URL";`);
    expect(result).toContain(`const doubleQuoted = "";`);
    expect(result).toContain(`const singleQuoted = "";`);
    expect(result).toContain(`const templateLiteral = "";`);
    expect(result).toContain(`const wsUrl = "";`);
    expect(result).toContain(`const configured = "https://example.com";`);
  });

  it("uses the quote-agnostic pattern in the container entrypoint", () => {
    const entrypoint = readFileSync(
      resolve(import.meta.dirname, "../env.sh"),
      "utf8",
    );

    expect(entrypoint).toContain(
      `sed -i -E 's#[\`"'"'"'](KANEO_TURNSTILE_SITE_KEY|KANEO_WS_URL)[\`"'"'"']#""#g' {} +`,
    );
  });
});
