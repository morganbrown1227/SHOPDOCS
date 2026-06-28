import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const EMPTY = { email: "", password: "", name: "", role: "viewer" };

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const load = async () => {
    try {
      const { data } = await api.get("/users");
      setUsers(data);
    } catch (e) { toast.error(formatApiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (u) => { setEditing(u); setForm({ email: u.email, password: "", name: u.name, role: u.role }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        const payload = { name: form.name, role: form.role };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${editing.id}`, payload);
        toast.success("User updated");
      } else {
        await api.post(`/users`, form);
        toast.success("User created");
      }
      setOpen(false);
      load();
    } catch (e2) { toast.error(formatApiError(e2)); }
  };

  const del = async (u) => {
    if (!window.confirm(`Delete user ${u.email}?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("Deleted");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="p-4 md:p-10 max-w-5xl">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <div className="label-caps">Admin</div>
          <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight">Users & Roles</h1>
        </div>
        <Button data-testid="new-user-btn" onClick={openCreate} className="h-14 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-wider">
          <Plus className="h-5 w-5 mr-1" strokeWidth={3} /> New User
        </Button>
      </div>

      <div className="industrial-card">
        {users.map((u, idx) => (
          <div key={u.id} className={`industrial-row px-5 ${idx % 2 === 1 ? "bg-muted/40" : ""}`} data-testid={`user-row-${u.email}`}>
            <div className="flex-1 min-w-0">
              <div className="font-bold">{u.name}</div>
              <div className="font-mono text-xs text-muted-foreground truncate">{u.email}</div>
            </div>
            <span className="px-2 py-0.5 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider">{u.role}</span>
            <Button data-testid={`edit-user-${u.email}`} variant="outline" size="sm" className="h-11 w-11 rounded-sm border-2" onClick={() => openEdit(u)}>
              <Pencil className="h-4 w-4" strokeWidth={2.5} />
            </Button>
            {me?.id !== u.id && (
              <Button data-testid={`delete-user-${u.email}`} variant="ghost" size="sm" className="h-11 w-11 text-destructive hover:bg-destructive/10" onClick={() => del(u)}>
                <Trash2 className="h-4 w-4" strokeWidth={2.5} />
              </Button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">{editing ? "Edit User" : "New User"}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="label-caps">Name</Label>
              <Input data-testid="user-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-12 border-2 mt-1.5" />
            </div>
            <div>
              <Label className="label-caps">Email</Label>
              <Input data-testid="user-email" required type="email" disabled={!!editing} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-12 border-2 mt-1.5" />
            </div>
            <div>
              <Label className="label-caps">{editing ? "New Password (leave blank to keep)" : "Password"}</Label>
              <Input data-testid="user-password" type="password" required={!editing} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="h-12 border-2 mt-1.5" />
            </div>
            <div>
              <Label className="label-caps">Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger data-testid="user-role" className="h-12 border-2 mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="h-12 rounded-sm border-2" onClick={() => setOpen(false)}>Cancel</Button>
              <Button data-testid="user-submit" type="submit" className="h-12 rounded-sm bg-foreground text-background font-bold uppercase tracking-wider text-xs">
                {editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
