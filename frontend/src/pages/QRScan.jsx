import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScanLine, X, KeyRound, AlertTriangle } from "lucide-react";

export default function QRScan() {
  const nav = useNavigate();
  const scannerRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const start = async () => {
      try {
        const id = "qr-reader";
        const inst = new Html5Qrcode(id, { verbose: false });
        scannerRef.current = inst;
        await inst.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          async (decodedText) => {
            if (!active) return;
            await stop();
            resolve(decodedText);
          },
          () => {}
        );
        if (active) setScanning(true);
      } catch (e) {
        if (active) setError("Camera not available. Use manual entry below.");
      }
    };
    start();
    return () => {
      active = false;
      stop();
    };
    // eslint-disable-next-line
  }, []);

  const stop = async () => {
    try {
      const s = scannerRef.current;
      if (s) {
        await s.stop();
        await s.clear();
      }
    } catch {}
    scannerRef.current = null;
    setScanning(false);
  };

  const resolve = async (raw) => {
    setBusy(true);
    setError("");
    try {
      // Accept full URL or bare code
      let code = raw.trim();
      try {
        const u = new URL(code);
        const m = u.pathname.match(/\/qr\/(.+)$/);
        if (m) code = decodeURIComponent(m[1]);
      } catch {}
      const { data } = await api.get(`/equipment/by-qr/${encodeURIComponent(code)}`);
      nav(`/equipment/${data.id}`, { replace: true });
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-10 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="label-caps mb-1">QR Workflow</div>
          <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight">Scan Equipment</h1>
        </div>
        <Button
          data-testid="scan-cancel-btn"
          variant="outline"
          onClick={() => nav("/")}
          className="h-12 rounded-sm border-2 font-bold uppercase tracking-wider text-xs"
        >
          <X className="h-4 w-4 mr-1" strokeWidth={2.5} />
          Cancel
        </Button>
      </div>

      <div className="industrial-card overflow-hidden">
        <div className="relative bg-foreground aspect-square w-full max-h-[60vh]">
          <div id="qr-reader" className="w-full h-full" data-testid="qr-reader" />
          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-background gap-3">
              <ScanLine className="h-12 w-12" strokeWidth={2.5} />
              <div className="label-caps text-background/70">Initializing camera…</div>
            </div>
          )}
          {scanning && (
            <>
              {/* Corner reticles */}
              <div className="pointer-events-none absolute inset-10 border-2 border-accent" />
              <div className="pointer-events-none absolute top-6 left-6 w-10 h-10 border-l-4 border-t-4 border-accent" />
              <div className="pointer-events-none absolute top-6 right-6 w-10 h-10 border-r-4 border-t-4 border-accent" />
              <div className="pointer-events-none absolute bottom-6 left-6 w-10 h-10 border-l-4 border-b-4 border-accent" />
              <div className="pointer-events-none absolute bottom-6 right-6 w-10 h-10 border-r-4 border-b-4 border-accent" />
            </>
          )}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center gap-2 label-caps mb-3">
          <KeyRound className="h-4 w-4" strokeWidth={2.5} /> Enter code manually
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) resolve(manual.trim());
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <Input
            data-testid="manual-code-input"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="e.g. PRESS-12"
            className="h-14 border-2 text-base flex-1"
          />
          <Button
            data-testid="manual-code-submit"
            type="submit"
            disabled={busy || !manual.trim()}
            className="h-14 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-wider"
          >
            Open
          </Button>
        </form>
        {error && (
          <div data-testid="scan-error" className="mt-4 flex items-start gap-2 border-2 border-destructive bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5" strokeWidth={2.5} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
