import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Trash2, Cpu } from "lucide-react";

export default function AdminDeviceTypes() {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const { data } = await api.get("/device-types"); setItems(data); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post("/device-types", { name: name.trim() });
      setName("");
      toast.success("Device type added");
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  };

  const del = async (t) => {
    if (!window.confirm(`Delete device type "${t.name}"? Equipment already tagged with it will keep the label, but it won't appear as a choice anymore.`)) return;
    try {
      await api.delete(`/device-types/${t.id}`);
      toast.success("Deleted");
      load();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div className="p-4 md:p-10 max-w-3xl">
      <div className="label-caps">Admin</div>
      <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight">Device Types</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        Define the device-type vocabulary engineers see when tagging equipment. Examples: Pump, Drive, Pneumatic, Thermocouple, IR Sensor, Pressure.
      </p>

      <form onSubmit={add} className="flex gap-2 mb-6">
        <Input
          data-testid="device-type-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Pump"
          className="h-12 border-2 flex-1"
        />
        <Button data-testid="device-type-add-btn" type="submit" disabled={busy} className="h-12 rounded-sm bg-foreground text-background font-bold uppercase tracking-wider text-xs">
          <Plus className="h-4 w-4 mr-1" strokeWidth={3} /> Add
        </Button>
      </form>

      <div className="industrial-card">
        {items.length === 0 && <div className="p-6 label-caps">No device types yet.</div>}
        {items.map((t, idx) => (
          <div key={t.id} data-testid={`device-type-row-${t.name}`}
               className={`industrial-row px-5 ${idx % 2 === 1 ? "bg-muted/40" : ""}`}>
            <Cpu className="h-5 w-5 text-muted-foreground" strokeWidth={2.5} />
            <div className="flex-1 min-w-0 font-bold">{t.name}</div>
            <Button data-testid={`delete-device-type-${t.name}`} size="sm" variant="ghost"
                    className="h-11 w-11 text-destructive hover:bg-destructive/10" onClick={() => del(t)}>
              <Trash2 className="h-4 w-4" strokeWidth={2.5} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
