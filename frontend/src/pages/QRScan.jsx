import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import api, { formatApiError } from "@/lib/api";
import { describeMediaError, runCameraDiagnostics } from "@/lib/cameraDiagnostics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ScanLine, X, KeyRound, AlertTriangle, SwitchCamera, Stethoscope, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

const LAST_CAMERA_KEY = "shopdocs_last_camera_id";
const LOG_PREFIX = "[QRScan]";

export default function QRScan() {
  const nav = useNavigate();
  const scannerRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [lastCameraError, setLastCameraError] = useState(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diag, setDiag] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);

  useEffect(() => {
    let active = true;
    init(active);
    return () => {
      active = false;
      stop();
    };
    // eslint-disable-next-line
  }, []);

  const init = async (active) => {
    console.log(`${LOG_PREFIX} initializing — url=${window.location.href} isSecureContext=${window.isSecureContext}`);

    // getUserMedia is only exposed in secure contexts (HTTPS, or http://localhost
    // /127.0.0.1). Accessing ShopDocs via a plain http://<lan-ip-or-hostname>
    // URL — the common case for an on-prem/air-gapped deployment — is NOT a
    // secure context, so navigator.mediaDevices won't exist at all in any
    // browser, on any OS. This is a browser/platform restriction, not
    // something any scanning library can work around. Detect and explain it
    // up front instead of attempting to start the camera and failing generically.
    if (!window.isSecureContext) {
      const msg = `Camera access requires a secure connection. This page was loaded via ` +
        `${window.location.protocol}//${window.location.host}, and browsers only allow camera ` +
        `access on HTTPS pages (or http://localhost). Ask your admin to enable HTTPS for this ` +
        `deployment, or use manual entry below.`;
      console.error(`${LOG_PREFIX} insecure context — camera unavailable. protocol=${window.location.protocol} host=${window.location.host}`);
      if (active) setError(msg);
      return;
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      const msg = "This browser doesn't support camera access (navigator.mediaDevices is unavailable). Try a current version of Safari, Chrome, or Edge, or use manual entry below.";
      console.error(`${LOG_PREFIX} navigator.mediaDevices missing even though isSecureContext=true — unusual/very old browser.`);
      if (active) setError(msg);
      return;
    }

    let list;
    try {
      console.log(`${LOG_PREFIX} requesting camera list via Html5Qrcode.getCameras()`);
      list = await Html5Qrcode.getCameras();
      console.log(`${LOG_PREFIX} getCameras() returned ${list.length} device(s):`, list);
    } catch (e) {
      const info = describeMediaError(e);
      console.error(`${LOG_PREFIX} getCameras() failed — name=${info.name} message=${info.message}`, e);
      if (active) { setError(info.explanation); setLastCameraError(info); }
      return;
    }

    if (!active) return;

    if (!list || list.length === 0) {
      console.error(`${LOG_PREFIX} no video input devices reported by the browser.`);
      setError("No camera was found on this device. Use manual entry below.");
      return;
    }

    setCameras(list);

    const savedId = localStorage.getItem(LAST_CAMERA_KEY);
    const savedStillValid = savedId && list.some((c) => c.id === savedId);
    const rearGuess = list.find((c) => /back|rear|environment/i.test(c.label));
    const chosen = savedStillValid ? savedId : (rearGuess ? rearGuess.id : list[0].id);
    console.log(`${LOG_PREFIX} selecting camera "${chosen}" (saved=${!!savedStillValid}, rearGuess=${!!rearGuess})`);
    setSelectedCameraId(chosen);
    await startCamera(chosen);
  };

  const startCamera = async (cameraId) => {
    if (!cameraId) return;
    try {
      if (scannerRef.current) {
        await stop();
      }
      const inst = new Html5Qrcode("qr-reader", { verbose: false });
      scannerRef.current = inst;
      console.log(`${LOG_PREFIX} starting camera id=${cameraId}`);
      await inst.start(
        cameraId,
        { fps: 10, qrbox: { width: 260, height: 260 } },
        async (decodedText) => {
          await stop();
          resolve(decodedText);
        },
        () => {} // per-frame "no code found" callback — expected on almost every frame, not an error
      );
      console.log(`${LOG_PREFIX} camera started successfully.`);
      setScanning(true);
      setError("");
      setLastCameraError(null);
      localStorage.setItem(LAST_CAMERA_KEY, cameraId);
    } catch (e) {
      const info = describeMediaError(e);
      console.error(`${LOG_PREFIX} camera start failed — name=${info.name} message=${info.message}`, e);
      setError(info.explanation);
      setLastCameraError(info);
      setScanning(false);
    }
  };

  const switchCamera = async (cameraId) => {
    setSelectedCameraId(cameraId);
    await startCamera(cameraId);
  };

  const stop = async () => {
    try {
      const s = scannerRef.current;
      if (s) {
        if (s.isScanning) await s.stop();
        s.clear();
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} error while stopping camera (usually harmless):`, e);
    }
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

  const openDiagnostics = async () => {
    setDiagOpen(true);
    setDiagLoading(true);
    // Release our own camera first — otherwise the diagnostics getUserMedia
    // probe can spuriously report NotReadableError ("in use") on hardware/
    // browsers that don't allow two concurrent opens of the same camera.
    const wasScanning = scanning;
    if (wasScanning) await stop();
    console.log(`${LOG_PREFIX} running diagnostics…`);
    const result = await runCameraDiagnostics();
    console.log(`${LOG_PREFIX} diagnostics result:`, result);
    setDiag({ ...result, lastCameraError });
    setDiagLoading(false);
    if (wasScanning && selectedCameraId) await startCamera(selectedCameraId);
  };

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      toast.success("Diagnostics copied to clipboard");
    } catch {
      toast.error("Couldn't copy — clipboard access unavailable");
    }
  };

  return (
    <div className="p-4 md:p-10 max-w-3xl">
      <div className="flex items-center justify-between mb-6 gap-2">
        <div>
          <div className="label-caps mb-1">QR Workflow</div>
          <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight">Scan Equipment</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            data-testid="scan-diagnostics-btn"
            variant="outline"
            onClick={openDiagnostics}
            className="h-12 rounded-sm border-2 font-bold uppercase tracking-wider text-xs"
          >
            <Stethoscope className="h-4 w-4 mr-1" strokeWidth={2.5} />
            Diagnostics
          </Button>
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
      </div>

      {cameras.length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <Select value={selectedCameraId || undefined} onValueChange={switchCamera}>
            <SelectTrigger data-testid="scan-camera-select" className="h-12 border-2 flex-1">
              <SelectValue placeholder="Choose a camera" />
            </SelectTrigger>
            <SelectContent>
              {cameras.map((c, i) => (
                <SelectItem key={c.id} value={c.id}>{c.label || `Camera ${i + 1}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {cameras.length === 2 && (
            <Button
              data-testid="scan-switch-camera-btn"
              variant="outline"
              className="h-12 w-12 shrink-0 rounded-sm border-2"
              onClick={() => {
                const other = cameras.find((c) => c.id !== selectedCameraId);
                if (other) switchCamera(other.id);
              }}
              title="Switch camera"
            >
              <SwitchCamera className="h-5 w-5" strokeWidth={2.5} />
            </Button>
          )}
        </div>
      )}

      <div className="industrial-card overflow-hidden">
        <div className="relative bg-foreground aspect-square w-full max-h-[60vh]">
          <div id="qr-reader" className="w-full h-full" data-testid="qr-reader" />
          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-background gap-3 px-6 text-center">
              <ScanLine className="h-12 w-12" strokeWidth={2.5} />
              <div className="label-caps text-background/70">
                {error ? "Camera unavailable" : "Initializing camera…"}
              </div>
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
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" strokeWidth={2.5} />
            {error}
          </div>
        )}
      </div>

      <Dialog open={diagOpen} onOpenChange={setDiagOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Camera Diagnostics</DialogTitle>
            <DialogDescription>
              Details for troubleshooting camera access on this device/browser.
            </DialogDescription>
          </DialogHeader>
          {diagLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Running camera test…
            </div>
          ) : diag ? (
            <div className="space-y-3 font-mono text-xs">
              <DiagRow label="User Agent" value={diag.userAgent} wrap />
              <DiagRow label="Browser" value={`${diag.browserName} ${diag.browserVersion}`} />
              <DiagRow label="Platform" value={diag.platform} />
              <DiagRow label="Page URL" value={diag.url} wrap />
              <DiagRow label="Secure context" value={String(diag.isSecureContext)} bad={!diag.isSecureContext} />
              <DiagRow label="navigator.mediaDevices" value={diag.mediaDevicesAvailable ? "available" : "unavailable"} bad={!diag.mediaDevicesAvailable} />
              <DiagRow label="Video inputs detected" value={diag.videoInputCount == null ? "n/a" : String(diag.videoInputCount)} bad={diag.videoInputCount === 0} />
              {diag.videoInputs?.length > 0 && (
                <div>
                  <div className="text-muted-foreground mb-1">Devices:</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {diag.videoInputs.map((v) => <li key={v.deviceId}>{v.label}</li>)}
                  </ul>
                </div>
              )}
              <DiagRow label="getUserMedia test" value={diag.getUserMediaTest} bad={diag.getUserMediaTest === "failed"} />
              {diag.getUserMediaError && (
                <DiagRow label="getUserMedia error" value={`${diag.getUserMediaError.name}: ${diag.getUserMediaError.message}`} bad wrap />
              )}
              {diag.lastCameraError && (
                <DiagRow label="Last scan-start error" value={`${diag.lastCameraError.name}: ${diag.lastCameraError.message}`} bad wrap />
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={copyDiagnostics} disabled={!diag} className="rounded-sm border-2 font-bold uppercase text-xs">
              <Copy className="h-4 w-4 mr-1" strokeWidth={2.5} /> Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DiagRow({ label, value, bad, wrap }) {
  return (
    <div className="flex gap-2">
      <div className="text-muted-foreground shrink-0 w-40">{label}</div>
      <div className={`${bad ? "text-destructive font-bold" : ""} ${wrap ? "break-all" : "truncate"}`}>{value}</div>
    </div>
  );
}
