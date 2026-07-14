import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save } from "lucide-react";

export default function AdminSettings() {
  const [labelWidth, setLabelWidth] = useState("2.25");
  const [labelHeight, setLabelHeight] = useState("1.25");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/settings");
        setLabelWidth(String(data.label_width_in));
        setLabelHeight(String(data.label_height_in));
      } catch (e) { toast.error(formatApiError(e)); }
      finally { setLoaded(true); }
    })();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    const width = Number(labelWidth);
    const height = Number(labelHeight);
    if (!(width > 0) || !(height > 0)) {
      toast.error("Label width and height must be greater than 0");
      return;
    }
    setBusy(true);
    try {
      await api.put("/settings", { label_width_in: width, label_height_in: height });
      toast.success("Settings saved");
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  };

  if (!loaded) return null;

  return (
    <div className="p-4 md:p-10 max-w-xl">
      <div className="label-caps">Admin</div>
      <h1 className="font-display text-3xl md:text-4xl font-black tracking-tight">Settings</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-6">
        App-wide configuration.
      </p>

      <form onSubmit={save} className="industrial-card p-5 space-y-4">
        <div>
          <div className="label-caps mb-1">Label printing</div>
          <p className="text-sm text-muted-foreground">
            The physical size of the label stock loaded in your label printer (e.g. a Dymo 450).
            QR labels printed in "Single label" mode on the QR Print Sheet page are scaled to this size.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="label-width" className="label-caps mb-1 block">Width (in)</Label>
            <Input
              id="label-width"
              data-testid="settings-label-width"
              type="number"
              step="0.01"
              min="0.01"
              value={labelWidth}
              onChange={(e) => setLabelWidth(e.target.value)}
              className="h-12 border-2"
            />
          </div>
          <div>
            <Label htmlFor="label-height" className="label-caps mb-1 block">Height (in)</Label>
            <Input
              id="label-height"
              data-testid="settings-label-height"
              type="number"
              step="0.01"
              min="0.01"
              value={labelHeight}
              onChange={(e) => setLabelHeight(e.target.value)}
              className="h-12 border-2"
            />
          </div>
        </div>
        <Button data-testid="settings-save-btn" type="submit" disabled={busy}
                className="h-12 rounded-sm bg-foreground text-background font-bold uppercase tracking-wider text-xs">
          <Save className="h-4 w-4 mr-2" strokeWidth={2.5} />
          Save
        </Button>
      </form>
    </div>
  );
}
