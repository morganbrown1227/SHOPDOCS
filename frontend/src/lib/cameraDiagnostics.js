// Best-effort UA parsing for the diagnostics panel — this is for human-readable
// display only, never used for feature detection (we always feature-detect the
// actual APIs instead, since UA strings lie/lag across browser updates).
export function parseBrowser(ua) {
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isIOS = /iPhone|iPod/.test(ua) || isIPad;

  let name = "Unknown";
  let version = "";
  const match = (re) => ua.match(re)?.[1] || "";

  if (/CriOS\//.test(ua)) { name = "Chrome (iOS)"; version = match(/CriOS\/([\d.]+)/); }
  else if (/EdgiOS\//.test(ua)) { name = "Edge (iOS)"; version = match(/EdgiOS\/([\d.]+)/); }
  else if (/FxiOS\//.test(ua)) { name = "Firefox (iOS)"; version = match(/FxiOS\/([\d.]+)/); }
  else if (/SamsungBrowser\//.test(ua)) { name = "Samsung Internet"; version = match(/SamsungBrowser\/([\d.]+)/); }
  else if (/EdgA\/|Edg\//.test(ua)) { name = "Edge"; version = match(/Edg[A]?\/([\d.]+)/); }
  else if (/OPR\//.test(ua)) { name = "Opera"; version = match(/OPR\/([\d.]+)/); }
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) { name = "Chrome"; version = match(/Chrome\/([\d.]+)/); }
  else if (/Firefox\//.test(ua)) { name = "Firefox"; version = match(/Firefox\/([\d.]+)/); }
  else if (/Version\/[\d.]+.*Safari\//.test(ua)) { name = "Safari"; version = match(/Version\/([\d.]+)/); }

  let platform = "Unknown";
  if (isIPad) platform = "iPadOS";
  else if (/iPhone|iPod/.test(ua)) platform = "iOS";
  else if (/Android/.test(ua)) platform = "Android";
  else if (/Windows/.test(ua)) platform = "Windows";
  else if (/Macintosh/.test(ua)) platform = "macOS";
  else if (/Linux/.test(ua)) platform = "Linux";

  return { name, version, platform, isIOS, isIPad };
}

// DOMException.name -> plain-English explanation. Covers both the modern
// spec names and the older vendor-prefixed ones some browsers still throw.
const ERROR_EXPLANATIONS = {
  NotAllowedError: "Camera permission was denied. Check your browser's site settings and allow camera access for this page, then reload.",
  PermissionDeniedError: "Camera permission was denied. Check your browser's site settings and allow camera access for this page, then reload.",
  NotFoundError: "No camera was found on this device.",
  DevicesNotFoundError: "No camera was found on this device.",
  NotReadableError: "The camera is already in use by another app or browser tab. Close it and try again.",
  TrackStartError: "The camera is already in use by another app or browser tab. Close it and try again.",
  OverconstrainedError: "The selected camera doesn't support the requested settings (e.g. a rear-facing camera). Try a different camera.",
  ConstraintNotSatisfiedError: "The selected camera doesn't support the requested settings (e.g. a rear-facing camera). Try a different camera.",
  SecurityError: "Camera access was blocked by the browser's security policy. This usually means the page isn't loaded over a secure connection (HTTPS).",
  AbortError: "Starting the camera was interrupted by the browser or hardware.",
  TypeError: "Invalid camera configuration.",
};

// html5-qrcode sometimes rejects with a plain string (e.g. its own
// "insecure context" message) instead of a DOMException — handle both.
export function describeMediaError(err) {
  if (typeof err === "string") {
    return { name: "Error", message: err, explanation: err };
  }
  const name = err?.name || "Error";
  const message = err?.message || String(err);
  return { name, message, explanation: ERROR_EXPLANATIONS[name] || message || "Unknown camera error." };
}

function isSecureOrigin() {
  if (window.location.protocol === "https:") return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

// Runs a live camera probe (this will show the permission prompt / camera
// light) and returns a plain object safe to JSON.stringify and display.
export async function runCameraDiagnostics() {
  const ua = navigator.userAgent;
  const browser = parseBrowser(ua);

  const diag = {
    timestamp: new Date().toISOString(),
    userAgent: ua,
    browserName: browser.name,
    browserVersion: browser.version,
    platform: browser.platform,
    url: window.location.href,
    protocol: window.location.protocol,
    host: window.location.host,
    isSecureContext: !!window.isSecureContext,
    isSecureOrigin: isSecureOrigin(),
    mediaDevicesAvailable: !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function"),
    enumerateDevicesAvailable: !!(navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function"),
    videoInputCount: null,
    videoInputs: [],
    getUserMediaTest: "not run",
    getUserMediaError: null,
  };

  if (diag.enumerateDevicesAvailable) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");
      diag.videoInputCount = videoInputs.length;
      diag.videoInputs = videoInputs.map((d, i) => ({
        label: d.label || `Camera ${i + 1} (label hidden until permission is granted)`,
        deviceId: d.deviceId,
      }));
    } catch (e) {
      diag.enumerateDevicesError = e.message;
    }
  }

  if (diag.mediaDevicesAvailable) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      diag.getUserMediaTest = "success";
      stream.getTracks().forEach((t) => t.stop());
      // Labels are only populated post-permission — re-enumerate to get them.
      if (diag.enumerateDevicesAvailable) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === "videoinput");
        diag.videoInputCount = videoInputs.length;
        diag.videoInputs = videoInputs.map((d, i) => ({ label: d.label || `Camera ${i + 1}`, deviceId: d.deviceId }));
      }
    } catch (e) {
      diag.getUserMediaTest = "failed";
      diag.getUserMediaError = describeMediaError(e);
    }
  } else {
    diag.getUserMediaTest = "unavailable (navigator.mediaDevices is missing)";
  }

  return diag;
}
