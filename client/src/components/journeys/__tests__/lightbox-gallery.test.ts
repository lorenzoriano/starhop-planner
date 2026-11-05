import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The viewer renders in a portal on <body>; for static markup, render it in place.
vi.mock("react-dom", async (orig) => ({ ...(await orig<typeof import("react-dom")>()), createPortal: (node: unknown) => node }));
vi.stubGlobal("document", { body: {} });

const { ImageLightbox } = await import("../ImageLightbox");

const images = [
  { src: "./hst.jpg", large: "./hst-large.jpg", alt: "Photograph of M42.", caption: "Hubble mosaic.", credit: "NASA/ESA", license: "PD", label: "Photograph" },
  { src: "./field.jpg", alt: "Sky-survey photograph of M42.", caption: "DSS2 field.", credit: "DSS2", license: "Survey", label: "Sky-survey photograph" },
  { src: "./ir.jpg", alt: "Infrared view of M42.", caption: "2MASS.", credit: "2MASS", license: "PD", label: "Infrared view" },
];
const render = (start = 0, list = images) => renderToStaticMarkup(createElement(ImageLightbox, { images: list, start, title: "Orion Nebula", onClose: () => {} }));

describe("image lightbox gallery", () => {
  it("opens at the requested picture and says where you are", () => {
    const html = render(1);
    expect(html).toContain("2 of 3");
    expect(html).toContain('src="./field.jpg"');
    expect(html).toContain("Sky-survey photograph. </strong>DSS2 field.");
  });

  it("offers previous / next and a thumbnail for every picture", () => {
    const html = render();
    expect(html).toContain('data-testid="journey-lightbox-prev"');
    expect(html).toContain('data-testid="journey-lightbox-next"');
    expect(html.match(/aria-label="Picture \d of 3/g)).toHaveLength(3);
    expect(html).toMatch(/aria-pressed="true" aria-label="Picture 1 of 3: Photograph"/);
  });

  it("is a plain viewer with a single picture (no gallery controls)", () => {
    const html = render(0, images.slice(0, 1));
    expect(html).not.toContain("of 1");
    expect(html).not.toContain("journey-lightbox-next");
    expect(html).not.toContain("jlightbox-thumbs");
  });
});
