import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, Download, RefreshCw, FolderOpen } from "lucide-react";

const CSV_TEMPLATE = "equipment_id,file_path,category,title,revision\n"
  + "PRESS-12,PRESS-12/assembly-drawing.pdf,drawing,Assembly Drawing,B\n"
  + "PRESS-12,PRESS-12/operator-manual.pdf,manual,,\n";

export default function AdminDocumentImport() {
  const [staged, setStaged] = useState([]);
  const [stagedError, setStagedError] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadStaged = async () => {
    try {
      const { data } = await api.get("/documents/import/staging-files");
      setStaged(data);
      setStagedError("");
    } catch (e) { setStagedError(formatApiError(e)); }
  };

  useEffect(() => { loadStaged(); }, []);

  const doImport = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/documents/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      toast.success(`Imported ${data.created} · skipped ${data.skipped} · errors ${data.errors.length}`);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "document-import-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-10 max-w-3xl">
      <div className="label-caps">Admin</div>
      <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight">Bulk Import Documents</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        For loading a whole drawing package onto an existing set of equipment at once. Copy the files onto
        the server first (e.g. via <code className="font-mono">scp</code>/<code className="font-mono">rsync</code>),
        then upload a CSV mapping each file to an equipment record. For day-to-day document management, use
        "Upload doc" / "Upload new revision" on the equipment page instead.
      </p>

      <div className="industrial-card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="label-caps flex items-center gap-2">
            <FolderOpen className="h-4 w-4" strokeWidth={2.5} /> Files currently staged on the server
          </div>
          <Button data-testid="refresh-staged-files" size="sm" variant="outline" className="h-9 rounded-sm border-2 text-xs font-bold uppercase" onClick={loadStaged}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" strokeWidth={2.5} /> Refresh
          </Button>
        </div>
        {stagedError && <div className="text-sm text-destructive">{stagedError}</div>}
        {!stagedError && staged.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No files staged yet. Copy your drawing package into the server's staging directory, then hit Refresh.
          </div>
        )}
        {staged.length > 0 && (
          <ul data-testid="staged-files-list" className="font-mono text-xs max-h-64 overflow-y-auto space-y-0.5">
            {staged.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>

      <form onSubmit={doImport} className="industrial-card p-5 space-y-4">
        <div className="text-sm text-muted-foreground">
          Required columns: <code className="font-mono">equipment_id</code>, <code className="font-mono">file_path</code> (relative
          to the staging directory, as listed above). Optional: <code className="font-mono">category</code> (drawing/manual/other,
          default manual), <code className="font-mono">title</code> (defaults to the filename), <code className="font-mono">revision</code>.
        </div>
        <Button type="button" variant="outline" className="h-12 rounded-sm border-2 font-bold uppercase tracking-wider text-xs" onClick={downloadTemplate} data-testid="doc-csv-template-btn">
          <Download className="h-4 w-4 mr-1" strokeWidth={2.5} /> Download template
        </Button>
        <Input
          type="file" accept=".csv,text/csv" required data-testid="doc-csv-file-input" className="h-12 border-2"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {result && (
          <div data-testid="doc-csv-import-result" className="border-2 border-border p-3 text-sm">
            <div><b>Created:</b> {result.created} · <b>Skipped:</b> {result.skipped} · <b>Errors:</b> {result.errors.length}</div>
            {result.errors.length > 0 && (
              <ul className="mt-2 text-xs text-destructive font-mono">
                {result.errors.slice(0, 20).map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}
              </ul>
            )}
          </div>
        )}
        <Button data-testid="doc-csv-import-submit" type="submit" disabled={busy || !file}
                className="h-12 rounded-sm bg-foreground text-background font-bold uppercase tracking-wider text-xs">
          <Upload className="h-4 w-4 mr-1" strokeWidth={2.5} /> Import
        </Button>
      </form>
    </div>
  );
}
