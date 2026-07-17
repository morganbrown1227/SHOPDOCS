import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScanLine } from "lucide-react";
import logo from "@/assets/southwire-logo.jpg";
import loginBg from "@/assets/sw-scr-casting.jpg";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && user !== false && user !== null) {
      const dest = loc.state?.from?.pathname || "/";
      nav(dest, { replace: true });
    }
  }, [user, nav, loc.state]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await login(email.trim().toLowerCase(), password);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div
        className="hidden md:flex md:w-1/2 relative items-end p-12"
        style={{ backgroundImage: `url(${loginBg})`, backgroundSize: "cover", backgroundPosition: "center" }}
      >
        <div className="absolute inset-0 bg-black/65" />
        <div className="relative z-10 text-white max-w-md">
          <h1 className="font-display text-5xl font-black leading-[1.05] tracking-tight">
            Drawings.<br />Manuals.<br />Right where you need them.
          </h1>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 md:p-12 bg-background">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-10">
            <img src={logo} alt="Southwire" className="h-10 w-auto" />
            <div className="font-display font-black text-2xl leading-none tracking-tight">SHOPDOCS</div>
          </div>

          <h2 className="font-display text-3xl font-black mb-1">Sign in</h2>
          <p className="text-sm text-muted-foreground mb-8">Use your internal credentials.</p>

          <form onSubmit={submit} className="space-y-5">
            <div>
              <Label htmlFor="email" className="label-caps">Email</Label>
              <Input
                id="email"
                data-testid="login-email-input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 mt-2 border-2 text-base"
                placeholder="admin@local.app"
              />
            </div>
            <div>
              <Label htmlFor="password" className="label-caps">Password</Label>
              <Input
                id="password"
                data-testid="login-password-input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-14 mt-2 border-2 text-base"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <div data-testid="login-error" className="border-2 border-destructive bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
                {error}
              </div>
            )}
            <Button
              data-testid="login-submit-btn"
              type="submit"
              disabled={busy}
              className="w-full h-14 rounded-sm bg-foreground text-background hover:bg-foreground/90 font-bold uppercase tracking-wider"
            >
              {busy ? "Signing in…" : "Sign In"}
            </Button>
          </form>

          <div className="mt-8 border-t-2 border-border pt-6">
            <div className="flex items-center gap-3 text-muted-foreground">
              <ScanLine className="h-5 w-5" strokeWidth={2.5} />
              <p className="text-xs font-bold uppercase tracking-wider">
                After sign-in, scan any equipment QR to jump straight to its docs.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
