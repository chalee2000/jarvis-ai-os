import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown (XSS safety)", () => {
  it("does not render raw HTML, event handlers or javascript: links", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text={[
          "<script>alert('x')</script>",
          '<img src="x" onerror="alert(1)">',
          "<b onclick=\"alert(2)\">ตัวหนา</b>",
          "[คลิก](javascript:alert(3))",
          "![รูป](https://example.com/track.png)",
          "**ข้อความปกติ**",
        ].join("\n\n")}
      />,
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror|onclick/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("<strong>ข้อความปกติ</strong>");
  });

  it("opens links safely in a new tab", () => {
    const html = renderToStaticMarkup(<Markdown text="[ตัวอย่าง](https://example.com)" />);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
});
