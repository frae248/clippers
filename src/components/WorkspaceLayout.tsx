import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  Film,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Scissors,
  Settings,
  Type as TypeIcon,
  X,
  Youtube,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface WorkspaceLayoutProps {
  title: string;
  breadcrumb?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  fullBleed?: boolean;
}

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/dashboard/youtube', label: 'YouTube Clipper', icon: Youtube, end: false },
  { to: '/dashboard/new', label: 'New clipping project', icon: Plus, end: false },
  { to: '/dashboard/projects', label: 'My projects', icon: FolderKanban, end: false },
  { to: '/dashboard/clips', label: 'My clips', icon: Film, end: false },
  { to: '/dashboard/styles', label: 'Caption styles', icon: TypeIcon, end: false },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings, end: false },
];

export function WorkspaceLayout({
  title,
  breadcrumb,
  action,
  children,
  fullBleed = false,
}: WorkspaceLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#111111] border-r border-white/[0.08] w-64 shrink-0">
      <div className="h-16 flex items-center justify-between px-5 border-b border-white/[0.08]">
        <Link
          to="/"
          className="font-display text-lg font-bold tracking-tight text-white flex items-center gap-2.5 whitespace-nowrap shrink-0"
        >
          <span className="w-7 h-7 rounded-md bg-[#8B5CF6] flex items-center justify-center text-white">
            <Scissors className="w-4 h-4" />
          </span>
          CLIPFORGE
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close sidebar"
          className="lg:hidden text-zinc-400 hover:text-white p-1"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Workspace navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#8B5CF6]/15 text-white border border-[#8B5CF6]/30'
                    : 'text-zinc-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/[0.08]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-white truncate">{user?.username}</p>
            <p className="text-[11px] text-zinc-400 truncate">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#090909] text-white flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block shrink-0">{sidebarContent}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}

      {/* Main viewport */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        <header className="h-16 border-b border-white/[0.08] bg-[#090909] px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 -ml-2 text-zinc-400 hover:text-white rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              {breadcrumb && (
                <p className="text-[11px] text-zinc-400 truncate">{breadcrumb}</p>
              )}
              <h1 className="font-display text-base sm:text-lg font-semibold tracking-tight text-white truncate">
                {title}
              </h1>
            </div>
          </div>

          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </header>

        <main className={fullBleed ? 'flex-1 min-h-0' : 'flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto'}>
          {children}
        </main>
      </div>
    </div>
  );
}
