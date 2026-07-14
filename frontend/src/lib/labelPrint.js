// Shared single-label (e.g. Dymo) print builder, used by both the QR Print
// Sheet page and the single-equipment QR dialog — one implementation so the
// sizing math can't drift out of sync between the two entry points.
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Every dimension is an explicit inch value, never a CSS percentage — a
// percentage height on a flex item's main axis is unreliable in Chromium's
// print/pagination layout pass specifically (distinct from on-screen
// layout), and was the original cause of a single label spilling across
// multiple physical pages. Content is also deliberately sized well under
// the nominal label height (not filling it exactly) and top-aligned rather
// than centered, since the printer's actual usable/printable area can be
// smaller than its nominal media size (label printers commonly reserve a
// fixed unprintable margin for gap sensors, etc.) — centering makes any
// such shortfall look like "blank page, then content on the next page";
// top-aligning means the content is visible on the first label regardless.
export function buildSingleLabelHtml(items, labelSize, showName) {
  const w = labelSize.label_width_in;
  const h = labelSize.label_height_in;
  const pad = 0.05;
  const textBlockIn = showName ? 0.34 : 0.18;
  const availH = h - 2 * pad;
  const availW = w - 2 * pad;
  // 0.45 of the available height, not ~all of it — deliberate slack against
  // printable-area uncertainty, on top of the textBlockIn already reserved.
  const imgSizeIn = Math.round(Math.max(0.15, Math.min((availH - textBlockIn) * 0.7, availW)) * 1000) / 1000;

  const css = `
    * { box-sizing: border-box; }
    @page { size: ${w}in ${h}in; margin: 0; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; }
    .label {
      width: ${w}in; height: ${h}in; padding: ${pad}in;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
      page-break-after: always; overflow: hidden;
    }
    .label:last-child { page-break-after: auto; }
    .label img { width: ${imgSizeIn}in; height: ${imgSizeIn}in; object-fit: contain; flex-shrink: 0; }
    .label .name { font-weight: 700; font-size: 8pt; margin-top: 0.04in; line-height: 1.05; text-align: center; }
    .label .tag { font-family: 'Courier New', monospace; font-size: 7pt; margin-top: 0.02in; text-align: center; }
  `;
  const body = items.map((it) => `
    <div class="label">
      <img src="${it.qrUrl}" alt="QR ${it.tag}" />
      ${showName && it.name ? `<div class="name">${escapeHtml(it.name)}</div>` : ""}
      <div class="tag">${escapeHtml(it.tag)}</div>
    </div>
  `).join("");
  return { css, body };
}

export function openPrintWindow(title, css, body) {
  const w = window.open("", "_blank");
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title>
    <style>${css}</style></head>
    <body>${body}
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),500));<\/script>
    </body></html>`);
  w.document.close();
}
