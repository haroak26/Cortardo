import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Eye, Users, MousePointerClick, LayoutDashboard, LogOut, Mail, Calendar, ShieldCheck, Loader } from "lucide-react";
import { AppPage, PageHeader, PageHeading, StatCard, DataTable, Badge, FilterChip, ContentPanel, type DataTableColumn } from "@/components/ds";
import { Button } from "@/components/button";

type AdminStats = {
  totalUsers: number;
  totalWorkspaces: number;
  totalEvents: number;
  totalPageviews: number;
  totalSessions: number;
};

type AdminUser = {
  id: number;
  email: string;
  username: string;
  displayName: string | null;
  plan: string;
  emailVerified: boolean;
  createdAt: string;
  totpEnabled: boolean;
};

async function checkAdmin(): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/me", { credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/stats?days=${days}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Dashboard"
        description="Overview of platform-wide metrics"
        actions={
          <div className="flex items-center gap-2">
            {[7, 30, 90].map((d) => (
              <FilterChip
                key={d}
                active={days === d}
                onClick={() => setDays(d)}
              >
                {d}d
              </FilterChip>
            ))}
          </div>
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex flex-col gap-2 py-3 animate-pulse">
              <div className="h-3 w-16 bg-surface-hover rounded" />
              <div className="h-8 w-20 bg-surface-hover rounded" />
              <div className="h-3.5 w-24 bg-surface-hover rounded" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Pageviews"
            value={stats.totalPageviews.toLocaleString()}
            hint={`Last ${days} days`}
            icon={Eye}
            tone="brand"
          />
          <StatCard
            label="Sessions"
            value={stats.totalSessions.toLocaleString()}
            hint={`Last ${days} days`}
            icon={MousePointerClick}
            tone="info"
          />
          <StatCard
            label="Total Users"
            value={stats.totalUsers.toLocaleString()}
            hint="All time"
            icon={Users}
            tone="success"
          />
          <StatCard
            label="Workspaces"
            value={stats.totalWorkspaces.toLocaleString()}
            hint="All time"
            icon={LayoutDashboard}
            tone="neutral"
          />
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Failed to load stats</p>
      )}
    </div>
  );
}

function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/users", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setUsers(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const columns: DataTableColumn<AdminUser>[] = [
    {
      key: "user",
      header: "User",
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center shrink-0">
            <span className="text-white text-[10px] font-semibold">
              {(row.displayName || row.username).slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground truncate">
              {row.displayName || row.username}
            </div>
            <div className="text-[11px] text-fg-muted truncate">@{row.username}</div>
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Mail size={12} className="text-fg-subtle shrink-0" />
          <span className="text-[13px] text-foreground truncate">{row.email}</span>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      render: (row) => (
        <Badge tone={"brand"} size="sm">
          {row.plan}
        </Badge>
      ),
    },
    {
      key: "verified",
      header: "Verified",
      render: (row) =>
        row.emailVerified ? (
          <Badge tone="success" size="sm">Verified</Badge>
        ) : (
          <Badge tone="warning" size="sm">Unverified</Badge>
        ),
    },
    {
      key: "2fa",
      header: "2FA",
      align: "center",
      render: (row) =>
        row.totpEnabled ? (
          <ShieldCheck size={15} className="text-success" />
        ) : (
          <span className="text-fg-subtle text-[12px]">—</span>
        ),
    },
    {
      key: "created",
      header: "Joined",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Calendar size={12} className="text-fg-subtle shrink-0" />
          <span className="text-[12px] text-fg-muted">
            {new Date(row.createdAt).toLocaleDateString()}
          </span>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeading
        title="Users"
        description={`${users.length} registered users`}
      />
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-[52px] bg-surface-hover/50 rounded-[12px] animate-pulse" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={users}
          getRowKey={(u) => String(u.id)}
        />
      )}
    </div>
  );
}

export default function Admin() {
  const [, setLocation] = useLocation();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"dashboard" | "users">("dashboard");

  useEffect(() => {
    checkAdmin().then((ok) => {
      setAuthed(ok);
      if (!ok) setLocation("/admin/login");
    });
  }, []);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setLocation("/admin/login");
  };

  if (authed === null) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authed) return null;

  return (
    <AppPage>
      <ContentPanel
        header={
          <PageHeader
            title="Admin Panel"
            icon={LayoutDashboard}
            iconColor="#8b5cf6"
            actions={
              <div className="flex items-center gap-2">
                <FilterChip
                  active={tab === "dashboard"}
                  onClick={() => setTab("dashboard")}
                >
                  <LayoutDashboard size={13} /> Dashboard
                </FilterChip>
                <FilterChip
                  active={tab === "users"}
                  onClick={() => setTab("users")}
                >
                  <Users size={13} /> Users
                </FilterChip>
                <div className="w-px h-5 bg-border mx-1" />
                <Button design="ghost" size="xs" onClick={handleLogout}>
                  <LogOut size={13} /> Sign out
                </Button>
              </div>
            }
          />
        }
        maxWidth="wide"
      >
        {tab === "dashboard" ? <AdminDashboard /> : <AdminUsers />}
      </ContentPanel>
    </AppPage>
  );
}
