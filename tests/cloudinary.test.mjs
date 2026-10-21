import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { srcSetUrl } from "../src/lib/cloudinary.ts";

/**
 * A `srcset` separates its candidates with commas. A Cloudinary
 * transformation contains commas itself, so an unencoded URL is split by the
 * browser and the image never loads (the candidates point at a 404 or at the
 * HTML page).
 */
describe("the Cloudinary srcset", () => {
  it("encodes the commas of a transformation", () => {
    const url =
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/c_fit,h_76,w_152/DYNAMIC_Logo";
    const encoded = srcSetUrl(url);
    assert.equal(encoded.includes(","), false, "a candidate must not contain a comma");
    assert.ok(encoded.includes("%2C"), "the comma must be encoded");
  });

  it("keeps the candidates of a srcset parsable", () => {
    const candidates = [76, 152].map(
      (width) =>
        `${srcSetUrl(
          `https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/c_fit,h_${width},w_${width}/DYNAMIC_Logo`,
        )} ${width}w`,
    );
    const srcset = candidates.join(", ");

    // The browser splits on the comma that follows the descriptor: every part
    // must be a URL plus a width descriptor.
    const parts = srcset.split(/,\s+(?=[^,]+\s+\d+w$)/);
    assert.equal(parts.length, 2, "two candidates must be readable");
    for (const part of parts) {
      const [url, descriptor] = part.trim().split(/\s+/);
      assert.ok(url.startsWith("https://"), "a candidate must be an absolute URL");
      assert.match(descriptor, /^\d+w$/, "a candidate needs a width descriptor");
    }
  });

  it("does not change a URL without a transformation", () => {
    const url = "https://res.cloudinary.com/demo/image/upload/DYNAMIC_Logo";
    assert.equal(srcSetUrl(url), url);
  });
});
