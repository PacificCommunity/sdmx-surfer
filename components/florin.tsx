/**
 * The Data Surfer florin, as an inline glyph.
 *
 * The same drawing as the one in the wordmark: Trade Gothic's U+0192,
 * outlined. It has to be the same, because in running text this is not a
 * letter, it is the mark being quoted. Setting it in Inter instead, which is
 * what the headline is otherwise, gave two different florins in the same view
 * and it stopped reading as one identity.
 *
 * Inline SVG rather than an <img> so it inherits `currentColor`, and because a
 * single path costs less than a request.
 *
 * Metrics come from the font: the glyph spans 929 units of a 1000 unit em and
 * descends 184 below the baseline. So its height is 0.929em of the surrounding
 * font size, and it is pushed down 0.184em to put its baseline on the text
 * baseline, which a replaced element otherwise aligns by its bottom edge.
 */
export function Florin({ className }: { className?: string }) {
  return (
    <svg
      viewBox="37 -745 648 929"
      role="img"
      aria-label="f"
      className={className}
      style={{
        height: "0.929em",
        width: "0.648em",
        display: "inline-block",
        verticalAlign: "-0.184em",
      }}
    >
      <g transform="scale(1,-1)">
        <path d="M155 476H332L342 519Q352 560 364.5 601.0Q377 642 402.0 674.5Q427 707 468.5 726.5Q510 746 578 745Q623 744 649.0 738.0Q675 732 685 730L664 624Q654 626 630.5 632.5Q607 639 569 639Q540 639 523.0 631.5Q506 624 496.5 610.5Q487 597 482.0 578.0Q477 559 473 537L461 476H634V370H442L384 74Q369 -1 351.5 -51.0Q334 -101 307.5 -130.5Q281 -160 243.5 -172.0Q206 -184 151 -184Q112 -184 84.0 -180.0Q56 -176 37 -172L57 -65Q76 -70 96.0 -74.0Q116 -78 139 -78Q166 -78 184.0 -72.5Q202 -67 215.0 -54.0Q228 -41 236.0 -19.0Q244 3 250 35L313 370H155Z" fill="currentColor" />
      </g>
    </svg>
  );
}
