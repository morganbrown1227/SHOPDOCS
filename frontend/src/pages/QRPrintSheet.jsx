import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { API_BASE, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Printer, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";

export default function QRPrintSheet() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [line, setLine] = useState("");
  const [cols, setCols] = useState("3");
  const [showName, setShowName] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/equipment");
        setItems(data);
      } catch (e) { setError(formatApiError(e)); }
    })();
  }, []);

  const lines = useMemo(() => Array.from(new Set(items.map((i) => i.line).filter(Boolean))), [items]);
  const filtered = useMemo(() => items.filter((it) => {
    const term = q.toLowerCase().trim();
    const okQ = !term || [it.name, it.equipment_id, it.model, it.location]
      .some((v) => (v || "").toLowerCase().includes(term));
    const okL = !line || it.line === line;
    return okQ && okL;
  }), [items, q, line]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const selectAllVisible = () => setSelected(new Set(filtered.map((i) => i.id)));
  const clearAll = () => setSelected(new Set());

  const print = () => {
    if (selected.size === 0) { toast.error("Select at least one equipment"); return; }
    const chosen = items.filter((i) => selected.has(i.id));
    const colCount = Number(cols);
    const tileCss = `
      * { box-sizing: border-box; }
      body { font-family: 'IBM Plex Sans', system-ui, sans-serif; margin: 0; padding: 12mm; }
      .grid { display: grid; grid-template-columns: repeat(${colCount}, 1fr); gap: 8mm; }
      .tile { border: 2px solid #000; padding: 6mm; text-align: center; page-break-inside: avoid; }
      .tile img { width: 100%; height: auto; max-width: 60mm; aspect-ratio: 1/1; display: block; margin: 0 auto; }
      .tile .name { font-weight: 800; font-size: 11pt; margin-top: 4mm; line-height: 1.15; }
      .tile .tag  { font-family: 'JetBrains Mono', monospace; font-size: 9pt; margin-top: 1mm; }
      .tile .meta { font-size: 8pt; color: #444; margin-top: 1mm; }
      @media print { @page { margin: 12mm; } }
    `;
    const tiles = chosen.map((it) => `
      <div class="tile">
        <img src="${API_BASE}/equipment/${it.id}/qr.png" alt="QR ${it.equipment_id}" />
        ${showName ? `<div class="name">${escapeHtml(it.name)}</div>` : ""}
        <div class="tag">${escapeHtml(it.equipment_id)}</div>
        <div class="meta">${[it.line, it.system, it.device_type].filter(Boolean).map(escapeHtml).join(" · ")}</div>
      </div>
    `).join("");
    const w = window.open("", "_blank");
    w.document.write(`<!doctype html><html><head><title>QR Labels — ${chosen.length}</title>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;700;800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
      <style>${tileCss}</style></head>
      <body><div class="grid">${tiles}</div>
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),500));<\/script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="p-4 md:p-10 max-w-6xl">
      <Link to="/admin/equipment" className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-3" data-testid="back-to-equipment-mgmt">
        <ArrowLeft className="h-4 w-4 mr-1" strokeWidth={2.5} /> Equipment Manager
      </Link>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <div className="label-caps">Admin</div>
          <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight">QR Label Sheet</h1>
          <p className="text-sm text-muted-foreground mt-1">Select equipment, choose a layout, and print physical labels for the floor.</p>
        </div>
        <Button data-testid="print-selected-btn" onClick={print}
                className="h-14 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-wider">
          <Printer className="h-5 w-5 mr-2" strokeWidth={2.5} />
          Print {selected.size > 0 ? `(${selected.size})` : ""}
        </Button>
      </div>

      {error && <div className="border-2 border-destructive bg-destructive/5 px-3 py-2 text-destructive mb-4">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <Input data-testid="qrsheet-search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Filter…" className="h-12 border-2 md:col-span-2" />
        <Select value={line || "__all__"} onValueChange={(v) => setLine(v === "__all__" ? "" : v)}>
          <SelectTrigger data-testid="qrsheet-line" className="h-12 border-2"><SelectValue placeholder="All lines" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All lines</SelectItem>
            {lines.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={cols} onValueChange={setCols}>
          <SelectTrigger data-testid="qrsheet-cols" className="h-12 border-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="2">2 cols</SelectItem>
            <SelectItem value="3">3 cols</SelectItem>
            <SelectItem value="4">4 cols</SelectItem>
            <SelectItem value="6">6 cols (sticker)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button data-testid="select-all-visible" variant="outline" className="h-10 rounded-sm border-2 font-bold uppercase text-xs" onClick={selectAllVisible}>
            <CheckSquare className="h-4 w-4 mr-1" strokeWidth={2.5} /> Select all
          </Button>
          <Button data-testid="clear-selection" variant="outline" className="h-10 rounded-sm border-2 font-bold uppercase text-xs" onClick={clearAll}>
            <Square className="h-4 w-4 mr-1" strokeWidth={2.5} /> Clear
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <Checkbox checked={showName} onCheckedChange={setShowName} data-testid="qrsheet-show-name" />
          Show equipment name on label
        </label>
      </div>

      <div className="industrial-card">
        {filtered.length === 0 && <div className="p-6 label-caps">No equipment matches.</div>}
        {filtered.map((it, idx) => {
          const checked = selected.has(it.id);
          return (
            <label key={it.id} data-testid={`qrsheet-row-${it.equipment_id}`}
              className={`industrial-row px-5 cursor-pointer ${idx % 2 === 1 ? "bg-muted/40" : ""} ${checked ? "bg-primary/5" : ""}`}>
              <Checkbox checked={checked} onCheckedChange={() => toggle(it.id)} />
              <img alt="" src={`${API_BASE}/equipment/${it.id}/qr.png`}
                   className="w-12 h-12 border border-border" />
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{it.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{it.equipment_id} {it.line && `· ${it.line}`} {it.system && `· ${it.system}`} {it.device_type && `· ${it.device_type}`}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
