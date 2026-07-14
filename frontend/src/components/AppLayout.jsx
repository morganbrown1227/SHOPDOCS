import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth, canEdit, isAdmin } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Home, ScanLine, Search, Settings, LogOut, FileCog, Users, ClipboardList, Hammer, Cpu, FolderUp } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";

function NavItem({ to, icon: Icon, label, testId, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      data-testid={testId}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-3 border-l-4 transition-none font-medium ${
          isActive
            ? "border-primary bg-primary/5 text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary"
        }`
      }
    >
      <Icon className="h-5 w-5" strokeWidth={2.5} />
      <span className="text-sm uppercase tracking-wider">{label}</span>
    </NavLink>
  );
}

function MobileNavItem({ to, icon: Icon, label, testId, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      data-testid={testId}
      className={({ isActive }) =>
        `flex-1 flex flex-col items-center justify-center gap-1 py-2 ${
          isActive ? "text-primary" : "text-muted-foreground"
        }`
      }
    >
      <Icon className="h-6 w-6" strokeWidth={2.5} />
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </NavLink>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const handleLogout = async () => {
    await logout();
    nav("/login");
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Top bar (mobile + desktop header) */}
      <header className="md:hidden border-b-2 border-foreground bg-background sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 h-14">
          <Link to="/" data-testid="brand-link" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-foreground text-background flex items-center justify-center">
              <Hammer className="h-4 w-4" strokeWidth={3} />
            </div>
            <span className="font-display font-black text-base tracking-tight">SHOPDOCS</span>
          </Link>
          <Button
            data-testid="mobile-logout-btn"
            variant="ghost"
            size="sm"
            className="h-10"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 mr-1" strokeWidth={2.5} />
            <span className="text-xs font-bold uppercase">Exit</span>
          </Button>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col w-64 border-r-2 border-foreground bg-background shrink-0">
        <Link to="/" data-testid="brand-link-desktop" className="px-5 py-5 border-b-2 border-foreground flex items-center gap-3">
          <div className="w-9 h-9 bg-foreground text-background flex items-center justify-center">
            <Hammer className="h-5 w-5" strokeWidth={3} />
          </div>
          <div>
            <div className="font-display font-black text-lg leading-none tracking-tight">SHOPDOCS</div>
            <div className="label-caps mt-1">Air-gapped DMS</div>
          </div>
        </Link>
        <nav className="flex-1 py-2">
          <NavItem to="/" end icon={Home} label="Equipment" testId="nav-equipment" />
          <NavItem to="/scan" icon={ScanLine} label="Scan QR" testId="nav-scan" />
          <NavItem to="/search" icon={Search} label="Search" testId="nav-search" />
          {canEdit(user) && (
            <>
              <div className="px-4 mt-4 mb-2 label-caps">Manage</div>
              <NavItem to="/admin/equipment" icon={FileCog} label="Equipment Mgmt" testId="nav-admin-equipment" />
              <NavItem to="/admin/documents-import" icon={FolderUp} label="Import Documents" testId="nav-admin-documents-import" />
            </>
          )}
          {isAdmin(user) && (
            <>
              <NavItem to="/admin/users" icon={Users} label="Users" testId="nav-admin-users" />
              <NavItem to="/admin/device-types" icon={Cpu} label="Device Types" testId="nav-admin-device-types" />
              <NavItem to="/admin/audit" icon={ClipboardList} label="Audit Log" testId="nav-admin-audit" />
              <NavItem to="/admin/settings" icon={Settings} label="Settings" testId="nav-admin-settings" />
            </>
          )}
        </nav>
        <div className="border-t-2 border-border p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Signed in</div>
          <div data-testid="current-user-name" className="font-mono text-sm font-bold truncate">{user?.email}</div>
          <div className="mt-1 inline-block px-2 py-0.5 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider" data-testid="current-user-role">
            {user?.role}
          </div>
          <Button
            data-testid="desktop-logout-btn"
            onClick={handleLogout}
            className="w-full mt-3 h-12 rounded-sm bg-foreground text-background hover:bg-foreground/90"
          >
            <LogOut className="h-4 w-4 mr-2" strokeWidth={2.5} />
            <span className="font-bold uppercase tracking-wider text-xs">Sign Out</span>
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 pb-20 md:pb-0 bg-background">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-background border-t-2 border-foreground z-30 flex">
        <MobileNavItem to="/" end icon={Home} label="Home" testId="mobile-nav-home" />
        <MobileNavItem to="/scan" icon={ScanLine} label="Scan" testId="mobile-nav-scan" />
        <MobileNavItem to="/search" icon={Search} label="Search" testId="mobile-nav-search" />
        {canEdit(user) && (
          <MobileNavItem to="/admin/equipment" icon={Settings} label="Manage" testId="mobile-nav-manage" />
        )}
      </nav>

      <Toaster position="top-right" />
    </div>
  );
}
