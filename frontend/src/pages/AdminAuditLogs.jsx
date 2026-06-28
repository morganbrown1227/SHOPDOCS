import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";

const ACTION_BG = {
  "user.create": "bg-primary",
  "user.update": "bg-primary",
  "user.delete": "bg-destructive",
  "equipment.create": "bg-primary",
  "equipment.update": "bg-primary",
  "equipment.delete": "bg-destructive",
  "document.upload": "bg-primary",
  "document.delete": "bg-destructive",
  "document.view": "bg-foreground",
  "document.download": "bg-foreground",
};

export default function AdminAuditLogs() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      try { const { data } = await api.get("/audit-logs"); setLogs(data); }
      catch (e) { setError(formatApiError(e)); }
    })();
  }, []);
  return (
    <div className="p-4 md:p-10 max-w-5xl">
      <div className="label-caps">Admin</div>
      <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight mb-6">Audit Log</h1>
      {error && <div className="border-2 border-destructive bg-destructive/5 px-3 py-2 text-destructive">{error}</div>}
      <div className="industrial-card">
        {logs.length === 0 && <div className="p-6 label-caps">No activity yet.</div>}
        {logs.map((l, idx) => (
          <div key={l.id} className={`industrial-row px-4 ${idx % 2 === 1 ? "bg-muted/40" : ""}`} data-testid={`audit-row-${l.id}`}>
            <span className={`shrink-0 ${ACTION_BG[l.action] || "bg-muted-foreground"} text-background text-[10px] font-bold uppercase tracking-wider px-2 py-1 font-mono`}>
              {l.action}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm"><b className="font-mono">{l.user_email}</b></div>
              <div className="text-xs text-muted-foreground truncate">
                {l.target_type}:{l.target_id?.slice(0, 8)}… ·{" "}
                {Object.entries(l.meta || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" · ")}
              </div>
            </div>
            <div className="shrink-0 font-mono text-xs text-muted-foreground">
              {new Date(l.timestamp).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
