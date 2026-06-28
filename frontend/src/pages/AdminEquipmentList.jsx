import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ArrowRight, Upload, QrCode, Download } from "lucide-react";
import { toast } from "sonner";

const CSV_TEMPLATE = "equipment_id,name,qr_code,line,system,device_type,model,revision,notes\nPRESS-12,200T Hydraulic Press,PRESS-12,Line A,Process Water,Pump,HP-200,A,Sample row\n";

export default function AdminEquipmentList() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);

  const load = async (term = "") => {
    try {
      const { data } = await api.get("/equipment", { params: term ? { q: term } : {} });
      setItems(data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const del = async (eq) => {
    if (!window.confirm(`Delete ${eq.equipment_id} - ${eq.name}? All attached documents will be removed.`)) return;
    try {
      await api.delete(`/equipment/${eq.id}`);
      toast.success("Equipment deleted");
      load(q);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const doImport = async (e) => {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      const { data } = await api.post("/equipment/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImportResult(data);
      toast.success(`Imported ${data.created} · skipped ${data.skipped} · errors ${data.errors.length}`);
      load(q);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "equipment-import-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-10 max-w-6xl">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <div className="label-caps">Admin</div>
          <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight">Equipment Manager</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/qr-sheet">
            <Button data-testid="open-qr-sheet-btn" variant="outline" className="h-14 rounded-sm border-2 font-bold uppercase tracking-wider">
              <QrCode className="h-5 w-5 mr-1" strokeWidth={2.5} /> QR Sheet
            </Button>
          </Link>
          <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) setImportResult(null); }}>
            <DialogTrigger asChild>
              <Button data-testid="import-csv-btn" variant="outline" className="h-14 rounded-sm border-2 font-bold uppercase tracking-wider">
                <Upload className="h-5 w-5 mr-1" strokeWidth={2.5} /> Import CSV
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display">Bulk Import Equipment</DialogTitle></DialogHeader>
              <form onSubmit={doImport} className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Required columns: <code className="font-mono">equipment_id</code>, <code className="font-mono">name</code>. Optional: <code className="font-mono">qr_code, line, system, device_type, model, revision, notes</code>.
                </div>
                <Button type="button" variant="outline" className="h-12 rounded-sm border-2 font-bold uppercase tracking-wider text-xs" onClick={downloadTemplate} data-testid="csv-template-btn">
                  <Download className="h-4 w-4 mr-1" strokeWidth={2.5} /> Download template
                </Button>
                <Input ref={fileRef} type="file" accept=".csv,text/csv" required data-testid="csv-file-input" className="h-12 border-2" />
                {importResult && (
                  <div data-testid="csv-import-result" className="border-2 border-border p-3 text-sm">
                    <div><b>Created:</b> {importResult.created} · <b>Skipped:</b> {importResult.skipped} · <b>Errors:</b> {importResult.errors.length}</div>
                    {importResult.errors.length > 0 && (
                      <ul className="mt-2 text-xs text-destructive font-mono">
                        {importResult.errors.slice(0, 8).map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" className="h-12 rounded-sm border-2" onClick={() => setImportOpen(false)}>Close</Button>
                  <Button data-testid="csv-import-submit" type="submit" className="h-12 rounded-sm bg-foreground text-background font-bold uppercase tracking-wider text-xs">
                    Import
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Link to="/admin/equipment/new">
            <Button data-testid="new-equipment-btn" className="h-14 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-wider">
              <Plus className="h-5 w-5 mr-1" strokeWidth={3} /> New
            </Button>
          </Link>
        </div>
      </div>
      <Input
        data-testid="admin-equipment-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search…"
        className="h-12 border-2 mb-4"
      />
      <div className="industrial-card">
        {items.length === 0 && <div className="p-8 label-caps">No equipment yet.</div>}
        {items.map((it, idx) => (
          <div key={it.id} className={`industrial-row px-5 ${idx % 2 === 1 ? "bg-muted/40" : ""}`}
               data-testid={`admin-eq-${it.equipment_id}`}>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs font-bold text-primary tracking-wider">{it.equipment_id}</div>
              <div className="font-bold truncate">{it.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {it.line && `Line: ${it.line} · `}{it.system && `Sys: ${it.system} · `}{it.device_type && `Type: ${it.device_type} · `}{it.model && `Model: ${it.model}`}
              </div>
            </div>
            <Link to={`/equipment/${it.id}`}>
              <Button variant="outline" size="sm" className="h-11 rounded-sm border-2 font-bold uppercase text-xs">
                Open <ArrowRight className="h-4 w-4 ml-1" strokeWidth={2.5} />
              </Button>
            </Link>
            <Link to={`/admin/equipment/${it.id}/edit`}>
              <Button data-testid={`edit-eq-${it.equipment_id}`} variant="outline" size="sm" className="h-11 w-11 rounded-sm border-2">
                <Pencil className="h-4 w-4" strokeWidth={2.5} />
              </Button>
            </Link>
            <Button
              data-testid={`delete-eq-${it.equipment_id}`}
              size="sm"
              variant="ghost"
              className="h-11 w-11 text-destructive hover:bg-destructive/10"
              onClick={() => del(it)}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2.5} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
