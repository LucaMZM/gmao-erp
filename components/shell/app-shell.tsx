"use client";

import {
  Bell,
  Boxes,
  CalendarRange,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Command,
  Gauge,
  HardHat,
  LogOut,
  Moon,
  PackageSearch,
  FileChartColumn,
  ShieldCheck as GovernanceShield,
  QrCode,
  Repeat2,
  Search,
  Siren,
  Truck,
  Settings2,
  Sun,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { DemoUserSession } from "@/lib/server/auth";
import type { GlobalSearchResult } from "@/lib/server/repositories/search";
import type { ShellNotification } from "@/lib/server/repositories/shell";
import {
  hasPermission,
  type EnterprisePermission,
} from "@/lib/domain/governance";

const navigation: Array<{
  href: string;
  label: string;
  short: string;
  icon: typeof Gauge;
  permission?: EnterprisePermission;
}> = [
  {
    href: "/overview",
    label: "Centro de control",
    short: "Centro",
    icon: Gauge,
  },
  {
    href: "/my-work",
    label: "Mi trabajo",
    short: "Trabajo",
    icon: HardHat,
    permission: "workorder.execute",
  },
  { href: "/assets", label: "Activos", short: "Activos", icon: Boxes },
  {
    href: "/incidents",
    label: "Incidencias",
    short: "Avisos",
    icon: Siren,
    permission: "incident.report",
  },
  {
    href: "/work-orders",
    label: "Órdenes de trabajo",
    short: "Órdenes",
    icon: ClipboardList,
  },
  {
    href: "/maintenance-plans",
    label: "Planes preventivos",
    short: "Planes",
    icon: Repeat2,
    permission: "preventive.manage",
  },
  {
    href: "/planner",
    label: "Planner",
    short: "Agenda",
    icon: CalendarRange,
    permission: "planning.manage",
  },
  {
    href: "/reliability",
    label: "Reliability Center",
    short: "Reliability",
    icon: ChartNoAxesCombined,
    permission: "reliability.rca.manage",
  },
  {
    href: "/inventory",
    label: "Inventario MRO",
    short: "MRO",
    icon: PackageSearch,
  },
  {
    href: "/procurement",
    label: "Procurement",
    short: "Supply",
    icon: Truck,
    permission: "procurement.approve",
  },
  {
    href: "/reports",
    label: "Reporting Center",
    short: "Reporting",
    icon: FileChartColumn,
    permission: "reports.read",
  },
  {
    href: "/audit",
    label: "Auditoría",
    short: "Auditoría",
    icon: GovernanceShield,
    permission: "audit.read",
  },
  {
    href: "/governance",
    label: "Gobierno operativo",
    short: "Gobierno",
    icon: Settings2,
    permission: "governance.read",
  },
];

const defaultMobileNavigation = navigation.filter((item) =>
  [
    "/overview",
    "/incidents",
    "/work-orders",
    "/planner",
    "/inventory",
  ].includes(item.href),
);

export function AppShell({
  session,
  notifications,
  children,
}: {
  session: DemoUserSession;
  notifications: ShellNotification[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [commandOpen, setCommandOpen] = useState(false);
  const [plantOpen, setPlantOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [switchingSite, setSwitchingSite] = useState<string | null>(null);
  const visibleNavigation = navigation.filter(
    (item) =>
      !item.permission ||
      hasPermission(session.permissionCodes, item.permission),
  );
  const mobileNavigation =
    session.roleKey === "TECHNICIAN"
      ? [
          navigation.find((item) => item.href === "/my-work")!,
          {
            href: "/scan",
            label: "Identificar activo",
            short: "Escanear",
            icon: QrCode,
          },
          navigation.find((item) => item.href === "/incidents")!,
          navigation.find((item) => item.href === "/work-orders")!,
          navigation.find((item) => item.href === "/inventory")!,
        ]
      : defaultMobileNavigation;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setPlantOpen(false);
        setNotificationsOpen(false);
        setUserOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const closeMenus = () => {
    setPlantOpen(false);
    setNotificationsOpen(false);
    setUserOpen(false);
  };

  const changeTheme = () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("mazmi-theme", next);
  };

  const switchSite = async (siteId: string) => {
    if (siteId === session.siteId) {
      setPlantOpen(false);
      return;
    }
    setSwitchingSite(siteId);
    const response = await fetch("/api/session/site", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteId }),
    });
    setSwitchingSite(null);
    if (response.ok) {
      setPlantOpen(false);
      window.location.assign(new URL("/overview", window.location.origin));
    }
  };

  const logout = async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (response.ok) {
      router.replace("/");
      router.refresh();
    }
  };

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      <aside className="app-sidebar">
        <Link
          className="brand-lockup"
          href="/overview"
          aria-label="Mazmi Factory GMAO"
        >
          <span className="brand-symbol">M</span>
          <span className="brand-copy">
            <strong>Mazmi</strong>
            <small>Factory GMAO</small>
          </span>
        </Link>

        <nav className="primary-nav" aria-label="Navegación principal">
          <p className="nav-caption">Operaciones</p>
          {visibleNavigation.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/overview" &&
                pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <Link
                className={
                  active ? "primary-nav-item active" : "primary-nav-item"
                }
                href={item.href}
                key={item.href}
                onClick={closeMenus}
              >
                <span className="nav-icon">
                  <Icon size={17} strokeWidth={1.8} />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <span>
            <CheckCircle2 size={14} /> Sistemas operativos
          </span>
          <small>Sin incidencias de plataforma</small>
        </div>
      </aside>

      <div className="app-column">
        <header className="app-topbar">
          <div className="topbar-context">
            <button
              aria-expanded={plantOpen}
              className="plant-switcher"
              onClick={() => setPlantOpen((open) => !open)}
              type="button"
            >
              <span className="plant-monogram">
                {session.siteCode.split("-").slice(-1)[0]}
              </span>
              <span>
                <small>Centro activo</small>
                <strong>{session.siteShortName}</strong>
              </span>
              <ChevronDown size={14} />
            </button>
            {plantOpen ? (
              <div className="floating-menu plant-menu">
                <p className="menu-label">Centros disponibles</p>
                {session.sites.map((site) => (
                  <button
                    className={
                      site.id === session.siteId
                        ? "site-option selected"
                        : "site-option"
                    }
                    disabled={switchingSite === site.id}
                    key={site.id}
                    onClick={() => switchSite(site.id)}
                    type="button"
                  >
                    <span>
                      <strong>{site.name}</strong>
                      <small>
                        {site.code} · {site.city}
                      </small>
                    </span>
                    {site.id === session.siteId ? (
                      <CheckCircle2 size={15} />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="topbar-tools">
            <button
              aria-label="Buscar en Mazmi"
              className="command-trigger"
              onClick={() => setCommandOpen(true)}
              type="button"
            >
              <Search size={15} />
              <span>Buscar activo, OT o recambio</span>
              <kbd>
                <Command size={10} />K
              </kbd>
            </button>
            <button
              className="round-tool theme-toggle"
              onClick={changeTheme}
              type="button"
              aria-label="Cambiar tema"
            >
              <Moon className="theme-light-icon" size={16} />
              <Sun className="theme-dark-icon" size={16} />
            </button>
            <div className="tool-anchor">
              <button
                className="round-tool"
                onClick={() => setNotificationsOpen((open) => !open)}
                type="button"
                aria-label="Notificaciones"
                aria-expanded={notificationsOpen}
              >
                <Bell size={16} />
                {notifications.length ? (
                  <i className="notification-dot" />
                ) : null}
              </button>
              {notificationsOpen ? (
                <div className="floating-menu notification-menu">
                  <div className="menu-heading">
                    <span>
                      <strong>Notificaciones</strong>
                      <small>{notifications.length} sin leer</small>
                    </span>
                  </div>
                  {notifications.length ? (
                    notifications.map((notification) => (
                      <div className="notification-item" key={notification.id}>
                        <i
                          className={`severity-${notification.severity.toLowerCase()}`}
                        />
                        <span>
                          <strong>{notification.title}</strong>
                          <small>{notification.body}</small>
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="menu-empty">Todo al día.</p>
                  )}
                </div>
              ) : null}
            </div>
            <div className="tool-anchor">
              <button
                className="user-trigger"
                onClick={() => setUserOpen((open) => !open)}
                type="button"
                aria-label="Menú de usuario"
                aria-expanded={userOpen}
              >
                <span>{session.initials}</span>
              </button>
              {userOpen ? (
                <div className="floating-menu user-menu">
                  <div className="user-summary">
                    <span className="large-avatar">{session.initials}</span>
                    <div>
                      <strong>{session.fullName}</strong>
                      <small>{session.roleName}</small>
                    </div>
                  </div>
                  <div className="menu-separator" />
                  <button type="button">
                    <Settings2 size={15} /> Preferencias
                  </button>
                  <button
                    className="logout-action"
                    onClick={logout}
                    type="button"
                  >
                    <LogOut size={15} /> Cerrar sesión
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="app-main" id="main-content">
          {children}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegación móvil">
        {mobileNavigation.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/overview" && pathname.startsWith(`${item.href}/`));
          const Icon = item.icon;
          return (
            <Link
              className={active ? "active" : ""}
              href={item.href}
              key={item.href}
              onClick={closeMenus}
            >
              <Icon size={18} />
              <span>{item.short}</span>
            </Link>
          );
        })}
      </nav>

      {commandOpen ? (
        <CommandPalette onClose={() => setCommandOpen(false)} router={router} />
      ) : null}
    </div>
  );
}

function CommandPalette({
  onClose,
  router,
}: {
  onClose: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as {
          data?: GlobalSearchResult[];
        };
        setResults(payload.data ?? []);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const openResult = (result: GlobalSearchResult) => {
    onClose();
    router.push(result.href);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        aria-label="Búsqueda global"
        aria-modal="true"
        className="command-palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="command-input-row">
          <Search size={18} />
          <input
            aria-label="Buscar en Mazmi"
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              if (next.trim().length < 2) setResults([]);
            }}
            placeholder="Buscar activo, OT, recambio…"
            ref={inputRef}
            value={query}
          />
          {loading ? (
            <span className="mini-spinner" />
          ) : (
            <button
              aria-label="Cerrar búsqueda"
              onClick={onClose}
              type="button"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="command-results">
          {!query ? (
            <div className="command-hint">
              <span>
                <Command size={14} /> Navegación rápida
              </span>
              <p>
                Busca por código industrial, descripción o referencia de
                fabricante.
              </p>
            </div>
          ) : query.length < 2 ? (
            <p className="command-empty">Escribe al menos dos caracteres.</p>
          ) : !loading && !results.length ? (
            <p className="command-empty">No hay resultados en este centro.</p>
          ) : (
            results.map((result) => (
              <button
                className="command-result"
                key={`${result.kind}-${result.id}`}
                onClick={() => openResult(result)}
                type="button"
              >
                <span
                  className={`result-kind kind-${result.kind.toLowerCase()}`}
                >
                  {result.kind === "ASSET"
                    ? "A"
                    : result.kind === "INCIDENT"
                      ? "INC"
                      : result.kind === "WORK_ORDER"
                        ? "OT"
                        : "MRO"}
                </span>
                <span>
                  <strong>{result.title}</strong>
                  <small>
                    {result.code} · {result.meta}
                  </small>
                </span>
                <kbd>↵</kbd>
              </button>
            ))
          )}
        </div>
        <footer>
          <span>↑↓ navegar</span>
          <span>↵ abrir</span>
          <span>esc cerrar</span>
        </footer>
      </section>
    </div>
  );
}
