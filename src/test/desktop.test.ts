import { describe, expect, it } from "vitest";
import { isDesktopApp } from "@/lib/desktop";

describe("isDesktopApp", () => {
  it("recognises the Mac app's user agent only", () => {
    expect(isDesktopApp("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 LOGOODesktop/0.1")).toBe(true);
    expect(isDesktopApp("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")).toBe(false);
    expect(isDesktopApp("")).toBe(false);
  });
});
