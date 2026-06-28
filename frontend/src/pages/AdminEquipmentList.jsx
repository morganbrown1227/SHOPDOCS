import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function AdminEquipmentList() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");

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

  return (
    <div className="p-4 md:p-10 max-w-6xl">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <div className="label-caps">Admin</div>
          <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight">Equipment Manager</h1>
        </div>
        <Link to="/admin/equipment/new">
          <Button data-testid="new-equipment-btn" className="h-14 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-wider">
            <Plus className="h-5 w-5 mr-1" strokeWidth={3} /> New
          </Button>
        </Link>
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
                {it.line && `Line: ${it.line} · `}{it.location && `Loc: ${it.location} · `}{it.model && `Model: ${it.model}`}
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
