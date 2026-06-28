import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ScanLine, ArrowRight, MapPin, Tag } from "lucide-react";
import { useAuth, canEdit } from "@/contexts/AuthContext";

export default function Dashboard() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const load = async (term = "") => {
    setLoading(true);
    try {
      const { data } = await api.get("/equipment", { params: term ? { q: term } : {} });
      setItems(data);
      setError("");
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const lines = useMemo(() => Array.from(new Set(items.map((i) => i.line).filter(Boolean))), [items]);

  return (
    <div className="p-4 md:p-10 max-w-6xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="label-caps mb-1">Floor directory</div>
          <h1 className="font-display text-3xl md:text-5xl font-black tracking-tight leading-none">
            Equipment
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {loading ? "Loading…" : `${items.length} record${items.length === 1 ? "" : "s"} · scan or search to open the right docs.`}
          </p>
        </div>
        <Link to="/scan" data-testid="open-scanner-btn" className="shrink-0">
          <Button className="h-14 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-wider">
            <ScanLine className="h-5 w-5 mr-2" strokeWidth={2.5} />
            Scan QR
          </Button>
        </Link>
      </div>

      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" strokeWidth={2.5} />
        <Input
          data-testid="dashboard-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, asset tag, model, line…"
          className="h-14 pl-11 border-2 text-base"
        />
      </div>

      {lines.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            data-testid="filter-all"
            onClick={() => setQ("")}
            className="px-3 py-1 border-2 border-border text-xs font-bold uppercase tracking-wider hover:border-foreground"
          >
            All
          </button>
          {lines.map((l) => (
            <button
              key={l}
              data-testid={`filter-line-${l}`}
              onClick={() => setQ(l)}
              className="px-3 py-1 border-2 border-border text-xs font-bold uppercase tracking-wider hover:border-foreground"
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div data-testid="dashboard-error" className="border-2 border-destructive bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive mb-4">
          {error}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div data-testid="empty-state" className="border-2 border-dashed border-border p-10 text-center">
          <div className="label-caps mb-2">Nothing here yet</div>
          <p className="text-sm text-muted-foreground mb-4">
            {canEdit(user)
              ? "Add your first piece of equipment to start mapping drawings and manuals."
              : "Ask an admin to add equipment records."}
          </p>
          {canEdit(user) && (
            <Link to="/admin/equipment">
              <Button className="h-12 rounded-sm bg-foreground text-background hover:bg-foreground/90 font-bold uppercase tracking-wider text-xs">
                Open Equipment Manager
              </Button>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 industrial-card divide-y-2 sm:divide-y-0 sm:divide-x-2 sm:[&>*]:border-b-2">
        {items.map((it, idx) => (
          <Link
            to={`/equipment/${it.id}`}
            key={it.id}
            data-testid={`equipment-card-${it.equipment_id}`}
            className={`group relative p-5 sm:p-6 hover:bg-secondary transition-none ${
              idx % 2 === 1 ? "sm:bg-muted/40" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs font-bold text-primary tracking-wider mb-1">{it.equipment_id}</div>
                <div className="font-display font-bold text-lg leading-tight truncate">{it.name}</div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {it.line && (
                <span className="flex items-center gap-1"><Tag className="h-3.5 w-3.5" strokeWidth={2.5} />{it.line}</span>
              )}
              {it.location && (
                <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" strokeWidth={2.5} />{it.location}</span>
              )}
              {it.model && <span className="font-mono">M: {it.model}</span>}
              {it.revision && <span className="font-mono">REV {it.revision}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
