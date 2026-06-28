import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

const EMPTY = { name: "", equipment_id: "", qr_code: "", line: "", location: "", model: "", revision: "", notes: "" };

export default function EquipmentForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) {
      (async () => {
        try {
          const { data } = await api.get(`/equipment/${id}`);
          setForm({
            name: data.name || "",
            equipment_id: data.equipment_id || "",
            qr_code: data.qr_code || "",
            line: data.line || "",
            location: data.location || "",
            model: data.model || "",
            revision: data.revision || "",
            notes: data.notes || "",
          });
        } catch (e) {
          toast.error(formatApiError(e));
        }
      })();
    }
  }, [editing, id]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form };
      if (!payload.qr_code) payload.qr_code = payload.equipment_id;
      const resp = editing
        ? await api.patch(`/equipment/${id}`, payload)
        : await api.post(`/equipment`, payload);
      toast.success(editing ? "Equipment updated" : "Equipment created");
      nav(`/equipment/${resp.data.id}`);
    } catch (e2) {
      toast.error(formatApiError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-10 max-w-3xl">
      <Link to="/admin/equipment" className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="h-4 w-4 mr-1" strokeWidth={2.5} /> Equipment Manager
      </Link>
      <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight mb-6">
        {editing ? "Edit Equipment" : "New Equipment"}
      </h1>
      <form onSubmit={submit} className="industrial-card p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <Label className="label-caps">Name *</Label>
            <Input data-testid="eq-name" required value={form.name} onChange={set("name")} className="h-12 border-2 mt-1.5" placeholder="200T Hydraulic Press" />
          </div>
          <div>
            <Label className="label-caps">Equipment ID / Asset Tag *</Label>
            <Input data-testid="eq-equipment-id" required value={form.equipment_id} onChange={set("equipment_id")} className="h-12 border-2 mt-1.5 font-mono" placeholder="PRESS-12" />
          </div>
          <div>
            <Label className="label-caps">QR Code (defaults to Asset Tag)</Label>
            <Input data-testid="eq-qr-code" value={form.qr_code} onChange={set("qr_code")} className="h-12 border-2 mt-1.5 font-mono" placeholder="PRESS-12" />
          </div>
          <div>
            <Label className="label-caps">Line</Label>
            <Input data-testid="eq-line" value={form.line} onChange={set("line")} className="h-12 border-2 mt-1.5" placeholder="Line A" />
          </div>
          <div>
            <Label className="label-caps">Location</Label>
            <Input data-testid="eq-location" value={form.location} onChange={set("location")} className="h-12 border-2 mt-1.5" placeholder="Bay 3" />
          </div>
          <div>
            <Label className="label-caps">Model</Label>
            <Input data-testid="eq-model" value={form.model} onChange={set("model")} className="h-12 border-2 mt-1.5 font-mono" placeholder="HP-200" />
          </div>
          <div>
            <Label className="label-caps">Revision</Label>
            <Input data-testid="eq-revision" value={form.revision} onChange={set("revision")} className="h-12 border-2 mt-1.5 font-mono" placeholder="A" />
          </div>
        </div>
        <div>
          <Label className="label-caps">Notes</Label>
          <Textarea data-testid="eq-notes" value={form.notes} onChange={set("notes")} rows={4} className="border-2 mt-1.5" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" className="h-12 rounded-sm border-2 font-bold uppercase text-xs" onClick={() => nav(-1)}>Cancel</Button>
          <Button data-testid="eq-submit" type="submit" disabled={busy} className="h-12 rounded-sm bg-foreground text-background font-bold uppercase tracking-wider text-xs">
            {busy ? "Saving…" : editing ? "Save Changes" : "Create"}
          </Button>
        </div>
      </form>
    </div>
  );
}
