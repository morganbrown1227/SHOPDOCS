import { useEffect, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import api, { API_BASE, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useAuth, canEdit } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  FileText, Image as ImageIcon, Download, Eye, Trash2, Upload, ArrowLeft,
  Hammer, MapPin, Tag, Layers, QrCode, Printer, History, RefreshCw,
} from "lucide-react";

const CATEGORY_META = {
  drawing: { label: "Drawings", icon: ImageIcon },
  manual: { label: "Manuals", icon: FileText },
  other: { label: "Other", icon: Layers },
};

function DocRow({ doc, onDelete, canManage, onPreview, onHistory, onReplace }) {
  const url = `${API_BASE}/documents/${doc.id}/file`;
  return (
    <div
      data-testid={`doc-row-${doc.id}`}
      className="industrial-row px-4 hover:bg-secondary"
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={2.5} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-bold text-base truncate">{doc.title}</div>
          <span className="shrink-0 px-1.5 py-0.5 bg-foreground text-background text-[10px] font-bold font-mono">V{doc.version}</span>
        </div>
        <div className="text-xs text-muted-foreground font-mono truncate">
          {doc.filename}
          {doc.revision ? ` · REV ${doc.revision}` : ""}
          {` · ${(doc.size / 1024).toFixed(0)} KB`}
        </div>
      </div>
      <Button
        data-testid={`doc-preview-${doc.id}`}
        size="sm"
        variant="outline"
        className="h-11 rounded-sm border-2 font-bold uppercase tracking-wider text-xs"
        onClick={() => onPreview(doc)}
      >
        <Eye className="h-4 w-4 mr-1" strokeWidth={2.5} />
        View
      </Button>
      <a
        data-testid={`doc-download-${doc.id}`}
        href={`${url}?download=1`}
        className="h-11 inline-flex items-center px-3 border-2 border-border rounded-sm hover:bg-secondary text-xs font-bold uppercase tracking-wider"
      >
        <Download className="h-4 w-4 mr-1" strokeWidth={2.5} />
        Download
      </a>
      <Button
        data-testid={`doc-history-${doc.id}`}
        size="sm"
        variant="ghost"
        className="h-11 w-11"
        onClick={() => onHistory(doc)}
        title="Version history"
      >
        <History className="h-4 w-4" strokeWidth={2.5} />
      </Button>
      {canManage && (
        <>
          <Button
            data-testid={`doc-replace-${doc.id}`}
            size="sm"
            variant="ghost"
            className="h-11 w-11"
            onClick={() => onReplace(doc)}
            title="Upload new revision"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
          </Button>
          <Button
            data-testid={`doc-delete-${doc.id}`}
            size="sm"
            variant="ghost"
            className="h-11 w-11 text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(doc)}
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.5} />
          </Button>
        </>
      )}
    </div>
  );
}

export default function EquipmentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const editable = canEdit(user);
  const [eq, setEq] = useState(null);
  const [docs, setDocs] = useState([]);
  const [error, setError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [history, setHistory] = useState(null); // {doc, versions}
  const [replaceTarget, setReplaceTarget] = useState(null);

  // upload form
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("manual");
  const [revision, setRevision] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, d] = await Promise.all([
        api.get(`/equipment/${id}`),
        api.get(`/equipment/${id}/documents`),
      ]);
      setEq(e.data);
      setDocs(d.data);
    } catch (err) {
      setError(formatApiError(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const submitUpload = async (e) => {
    e.preventDefault();
    if (!file || !title.trim()) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("category", category);
      if (revision) fd.append("revision", revision);
      if (replaceTarget) fd.append("replaces_id", replaceTarget.id);
      fd.append("file", file);
      await api.post(`/equipment/${id}/documents`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(replaceTarget ? "New revision uploaded" : "Document uploaded");
      setUploadOpen(false);
      setReplaceTarget(null);
      setTitle(""); setRevision(""); setFile(null); setCategory("manual");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const openReplace = (doc) => {
    setReplaceTarget(doc);
    setTitle(doc.title);
    setCategory(doc.category);
    setRevision("");
    setFile(null);
    setUploadOpen(true);
  };

  const openHistory = async (doc) => {
    try {
      const { data } = await api.get(`/documents/${doc.id}/versions`);
      setHistory({ doc, versions: data });
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const onDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  if (error) {
    return (
      <div className="p-8">
        <div className="border-2 border-destructive bg-destructive/5 px-4 py-3 text-destructive font-medium">{error}</div>
        <Button onClick={() => nav("/")} className="mt-4">Back</Button>
      </div>
    );
  }
  if (!eq) return <div className="p-8 label-caps">Loading…</div>;

  const grouped = {
    drawing: docs.filter((d) => d.category === "drawing"),
    manual: docs.filter((d) => d.category === "manual"),
    other: docs.filter((d) => d.category === "other"),
  };

  const qrPngUrl = `${API_BASE}/equipment/${eq.id}/qr.png`;

  return (
    <div className="p-4 md:p-10 max-w-5xl">
      <Link to="/" className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4" data-testid="back-to-list">
        <ArrowLeft className="h-4 w-4 mr-1" strokeWidth={2.5} /> Equipment
      </Link>

      <div className="industrial-card p-6 md:p-8 mb-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-xs font-bold text-primary tracking-wider">
              <Hammer className="h-3.5 w-3.5" strokeWidth={3} />
              {eq.equipment_id}
              {eq.qr_code && eq.qr_code !== eq.equipment_id && (
                <span className="text-muted-foreground">· QR: {eq.qr_code}</span>
              )}
            </div>
            <h1 data-testid="equipment-name" className="font-display text-3xl md:text-5xl font-black tracking-tight leading-none mt-2">
              {eq.name}
            </h1>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {eq.line && <span className="flex items-center gap-1.5"><Tag className="h-4 w-4 text-muted-foreground" strokeWidth={2.5} /><b>Line:</b> {eq.line}</span>}
              {eq.location && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={2.5} /><b>Loc:</b> {eq.location}</span>}
              {eq.model && <span className="font-mono"><b>Model:</b> {eq.model}</span>}
              {eq.revision && <span className="font-mono"><b>Rev:</b> {eq.revision}</span>}
            </div>
            {eq.notes && <p className="mt-4 text-sm text-muted-foreground whitespace-pre-wrap">{eq.notes}</p>}
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <Dialog open={qrOpen} onOpenChange={setQrOpen}>
              <DialogTrigger asChild>
                <Button data-testid="show-qr-btn" className="h-12 rounded-sm bg-foreground text-background hover:bg-foreground/90 font-bold uppercase tracking-wider text-xs">
                  <QrCode className="h-4 w-4 mr-1.5" strokeWidth={2.5} /> QR Code
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display">QR · {eq.equipment_id}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col items-center gap-3">
                  <img src={qrPngUrl} alt="QR" data-testid="qr-image" className="w-64 h-64 border-2 border-border" />
                  <div className="font-mono text-sm">{eq.qr_code || eq.equipment_id}</div>
                </div>
                <DialogFooter>
                  <a href={qrPngUrl} download={`qr-${eq.qr_code || eq.equipment_id}.png`}>
                    <Button data-testid="qr-download-btn" className="h-12 rounded-sm bg-primary text-primary-foreground font-bold uppercase tracking-wider text-xs">
                      <Download className="h-4 w-4 mr-1" strokeWidth={2.5} /> Download PNG
                    </Button>
                  </a>
                  <Button
                    data-testid="qr-print-btn"
                    onClick={() => {
                      const w = window.open("", "_blank");
                      w.document.write(`<html><head><title>QR ${eq.equipment_id}</title></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><img src="${qrPngUrl}" style="width:320px;height:320px;border:2px solid #000"/><div style="margin-top:12px;font-weight:700">${eq.name}</div><div style="font-family:monospace">${eq.equipment_id}</div></body></html>`);
                      w.document.close();
                      w.focus();
                      setTimeout(() => w.print(), 500);
                    }}
                    className="h-12 rounded-sm bg-foreground text-background font-bold uppercase tracking-wider text-xs"
                  >
                    <Printer className="h-4 w-4 mr-1" strokeWidth={2.5} /> Print
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {editable && (
              <>
                <Dialog open={uploadOpen} onOpenChange={(o) => { setUploadOpen(o); if (!o) setReplaceTarget(null); }}>
                  <DialogTrigger asChild>
                    <Button data-testid="upload-doc-btn" className="h-12 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-wider text-xs">
                      <Upload className="h-4 w-4 mr-1.5" strokeWidth={2.5} /> Upload Doc
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="font-display">
                        {replaceTarget ? `New Revision · ${replaceTarget.title}` : "Upload Document"}
                      </DialogTitle>
                    </DialogHeader>
                    <form onSubmit={submitUpload} className="space-y-4">
                      <div>
                        <Label className="label-caps">Title</Label>
                        <Input data-testid="upload-title" value={title} onChange={(e) => setTitle(e.target.value)} required className="h-12 border-2 mt-1.5" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="label-caps">Category</Label>
                          <Select value={category} onValueChange={setCategory}>
                            <SelectTrigger data-testid="upload-category" className="h-12 border-2 mt-1.5"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manual">Manual</SelectItem>
                              <SelectItem value="drawing">Drawing</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="label-caps">Revision</Label>
                          <Input data-testid="upload-revision" value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="A, 02…" className="h-12 border-2 mt-1.5" />
                        </div>
                      </div>
                      <div>
                        <Label className="label-caps">PDF File</Label>
                        <Input
                          data-testid="upload-file"
                          type="file"
                          accept="application/pdf,.pdf"
                          onChange={(e) => setFile(e.target.files?.[0] || null)}
                          required
                          className="h-12 border-2 mt-1.5"
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" className="h-12 rounded-sm border-2" onClick={() => setUploadOpen(false)}>Cancel</Button>
                        <Button data-testid="upload-submit" type="submit" disabled={busy} className="h-12 rounded-sm bg-foreground text-background font-bold uppercase tracking-wider text-xs">
                          {busy ? "Uploading…" : "Upload"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>

                <Link to={`/admin/equipment/${eq.id}/edit`}>
                  <Button variant="outline" data-testid="edit-equipment-btn" className="h-12 w-full rounded-sm border-2 font-bold uppercase tracking-wider text-xs">
                    Edit
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="drawing" className="industrial-card">
        <TabsList className="w-full h-14 rounded-none bg-background border-b-2 border-border p-0">
          {["drawing", "manual", "other"].map((c) => {
            const M = CATEGORY_META[c];
            return (
              <TabsTrigger
                key={c}
                value={c}
                data-testid={`tab-${c}`}
                className="h-14 flex-1 rounded-none font-bold uppercase tracking-wider text-xs data-[state=active]:bg-foreground data-[state=active]:text-background"
              >
                <M.icon className="h-4 w-4 mr-1.5" strokeWidth={2.5} />
                {M.label}
                <span className="ml-2 font-mono">({grouped[c].length})</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
        {["drawing", "manual", "other"].map((c) => (
          <TabsContent key={c} value={c} className="m-0">
            {grouped[c].length === 0 ? (
              <div className="p-10 text-center label-caps">No {CATEGORY_META[c].label.toLowerCase()} attached.</div>
            ) : (
              <div className="divide-y-2 divide-border">
                {grouped[c].map((d) => (
                  <DocRow key={d.id} doc={d} canManage={editable} onDelete={onDelete}
                          onPreview={setPreview} onHistory={openHistory} onReplace={openReplace} />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl w-[95vw] h-[85vh] p-0 flex flex-col">
          <DialogHeader className="px-5 pt-5 pb-3 border-b-2 border-border">
            <DialogTitle className="font-display truncate" data-testid="preview-title">{preview?.title}</DialogTitle>
          </DialogHeader>
          {preview && (
            <iframe
              data-testid="pdf-preview-iframe"
              title="preview"
              src={`${API_BASE}/documents/${preview.id}/file`}
              className="flex-1 w-full"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display" data-testid="history-title">
              History · {history?.doc?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="industrial-card">
            {history?.versions?.map((v, idx) => (
              <div key={v.id} data-testid={`history-row-${v.id}`}
                   className={`industrial-row px-4 ${idx % 2 === 1 ? "bg-muted/40" : ""}`}>
                <span className="shrink-0 px-1.5 py-0.5 bg-foreground text-background text-[10px] font-bold font-mono">
                  V{v.version}{v.is_latest ? " · LATEST" : ""}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs truncate">{v.filename}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {v.revision ? `REV ${v.revision} · ` : ""}{new Date(v.uploaded_at).toLocaleString()} · {v.uploaded_by}
                  </div>
                </div>
                <a data-testid={`history-view-${v.id}`} href={`${API_BASE}/documents/${v.id}/file`} target="_blank" rel="noreferrer"
                   className="h-10 inline-flex items-center px-3 border-2 border-border rounded-sm text-xs font-bold uppercase tracking-wider">
                  <Eye className="h-3.5 w-3.5 mr-1" strokeWidth={2.5} /> View
                </a>
                <a data-testid={`history-download-${v.id}`} href={`${API_BASE}/documents/${v.id}/file?download=1`}
                   className="h-10 inline-flex items-center px-3 border-2 border-border rounded-sm text-xs font-bold uppercase tracking-wider">
                  <Download className="h-3.5 w-3.5 mr-1" strokeWidth={2.5} /> Get
                </a>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
