import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Loader2, AlertTriangle } from "lucide-react";

// Self-hosted (not CDN) — required for the air-gapped/offline deployment
// this app targets. Kept in sync with the installed pdfjs-dist version by
// scripts/copy-pdf-worker.js, which runs on every `yarn install`.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// Renders every page of a PDF stacked in a scrollable column, using pdfjs
// (canvas rendering) rather than the browser's native PDF plugin via
// <iframe>. iOS Safari's embedded PDF viewer has a long-standing bug where a
// multi-page PDF shown in an iframe only renders/scrolls its first page —
// affects every iOS browser identically since they all share WebKit. This
// component sidesteps that entirely by drawing pages itself.
export default function PdfViewer({ fileUrl }) {
  const containerRef = useRef(null);
  const [numPages, setNumPages] = useState(null);
  const [error, setError] = useState("");
  const [pageWidth, setPageWidth] = useState(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setPageWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex-1 w-full overflow-y-auto bg-muted/30">
      <Document
        file={{ url: fileUrl, withCredentials: true }}
        onLoadSuccess={({ numPages }) => { setNumPages(numPages); setError(""); }}
        onLoadError={(e) => { console.error("[PdfViewer] failed to load PDF:", e); setError("Couldn't load this PDF. It may be corrupted or you may need to reload the page."); }}
        loading={
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading document…
          </div>
        }
        error={
          <div className="flex items-center gap-2 px-4 py-4 text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            Couldn't load this PDF. It may be corrupted or you may need to reload the page.
          </div>
        }
      >
        {!error && pageWidth && numPages && Array.from({ length: numPages }, (_, i) => (
          <div key={i} className="flex justify-center py-2">
            <Page
              pageNumber={i + 1}
              width={Math.min(pageWidth - 16, 900)}
              renderAnnotationLayer
              renderTextLayer
            />
          </div>
        ))}
      </Document>
      {numPages > 1 && (
        <div className="text-center text-xs text-muted-foreground py-2 label-caps">
          {numPages} pages
        </div>
      )}
    </div>
  );
}
