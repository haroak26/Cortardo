import React, { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight, ChevronDown } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon, Activity01Icon, Mail01Icon, Clock01Icon, News01Icon } from "@hugeicons/core-free-icons";

import { useUser, useLogout } from "@/hooks/use-user";
import { CookieBar } from "./CookieBar";
import { AnimatedLogo } from "./AnimatedLogo";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";


interface LayoutProps {
  children: React.ReactNode;
  showFooter?: boolean;
  panel?: boolean;
  /** Full-bleed layout: no max-width shell, so the page spans the whole viewport. */
  fullWidth?: boolean;
  /** Custom logo asset for the header/footer (e.g. the new Cortardo mark). */
  logo?: string;
  /** Extra classes for the header logo image (e.g. to override its height). */
  logoClassName?: string;
  /**
   * Landing full-bleed hero: aligns the right edge of the nav tabs and
   * auth buttons with the right edge of the hero image box instead of
   * the standard content gutter.
   */
  bleedHeader?: boolean;
  /**
   * Landing dark hero: header renders transparent over the dark hero and
   * gains its background/border only once scrolled. All inner chrome
   * (nav links, login link) switches to light-on-dark while at the top.
   */
  darkHero?: boolean;
}

const navDropdowns = [
  {
    label: "Resources",
    href: "/docs",
    items: [
      { icon: File01Icon, title: "Docs", desc: "Set up Cortardo in minutes", href: "/docs", tile: "bg-brand text-white", viewBox: "3 1 18 21.5" },
      { icon: Activity01Icon, title: "Status", desc: "Live uptime and incident history", href: "/status", tile: "bg-brand text-white", viewBox: "2 2 20 20" },
      { icon: Mail01Icon, title: "Contact", desc: "Reach the team behind Cortardo", href: "/contact", tile: "bg-brand text-white", viewBox: "1 1 22 22" },
      { icon: Clock01Icon, title: "Changelog", desc: "Every fix, feature, and release", href: "/changelog", tile: "bg-brand text-white", viewBox: "1 1 22 22" },
      { icon: News01Icon, title: "Blog", desc: "Stories, tips, and product news", href: "/blog", tile: "bg-brand text-white", viewBox: "1 1 22 22" },
    ],
  },
];

export function Layout({ children, showFooter = true, panel = false, fullWidth = false, logo, logoClassName, darkHero = false, bleedHeader = false }: LayoutProps) {
  const { data: user, isLoading: userLoading } = useUser();
  const logout = useLogout();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(document.documentElement.scrollTop > 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const handleNavEnter = (label: string) => {
    clearTimeout(hoverTimeout.current);
    setActiveDropdown(label);
  };

  const handleNavLeave = () => {
    hoverTimeout.current = setTimeout(() => setActiveDropdown(null), 120);
  };

  const handleDropdownEnter = () => {
    clearTimeout(hoverTimeout.current);
  };

  const logoSrc = logo ?? "/CortardoFull.svg?v=1";

  const overDark = darkHero && !scrolled && !mobileMenuOpen;

  const headerContent = (
    <header
      className={cn(
        "w-full h-16 md:h-[72px] z-40 sticky top-0 flex items-center border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled
          ? "bg-white/30 backdrop-blur-md border-border shadow-[0_1px_12px_rgb(15_23_42/0.04)]"
          : "bg-background border-transparent",
        overDark && "bg-[#07090f]/30 backdrop-blur-md border-transparent",
        panel && "border-border",
      )}
    >
      <div className={cn(
        "overflow-x-clip flex items-center justify-between",
        !fullWidth && "max-w-[1280px] mx-auto",
        bleedHeader
          ? "w-full pl-1.5 sm:pl-2 md:pl-3 pr-1.5 sm:pr-2 md:pr-3"
          : "w-full px-6 md:px-10",
      )}>
        <Link href="/" className={cn("flex items-center shrink-0 min-w-0", bleedHeader && "ml-3")}>
          {logo ? (
            <AnimatedLogo className={cn("h-[24px] md:h-[32px] shrink-0", logoClassName)} />
          ) : (
            <img src={logoSrc} alt="Cortardo" width={100} className="h-auto w-24 md:w-auto shrink-0" />
          )}
        </Link>
 
        <div className="flex items-center justify-end gap-2.5">
          <div className="hidden md:flex items-center gap-1">
            <nav ref={navRef} className="flex items-center gap-0.5">
              {[
                { label: "Product", href: "/product" },
                { label: "Pricing", href: "/pricing" },
                { label: "CodeBot", href: "/codebot" },
              ].map(({ label, href }) => (
                <Link
                  key={label}
                  href={href}
                  className={cn("inline-flex h-5 items-center text-[15px] font-medium px-3 leading-[20px] transition-colors hover:opacity-80", overDark ? "text-white/80 hover:text-white" : "text-foreground")}
                >
                  {label}
                </Link>
              ))}

              {navDropdowns.map(({ label, items }) => (
                <div
                  key={label}
                  className="relative flex items-center"
                  onMouseEnter={() => handleNavEnter(label)}
                  onMouseLeave={handleNavLeave}
                >
                  <button
                    type="button"
                    onClick={() => setActiveDropdown(activeDropdown === label ? null : label)}
                    className={cn(
                      "inline-flex h-5 items-center gap-1 text-[15px] font-medium px-3 leading-[20px] transition-colors cursor-pointer bg-transparent border-none",
                      overDark ? "text-white/80 hover:text-white" : "text-foreground hover:opacity-80",
                    )}
                    aria-expanded={activeDropdown === label}
                  >
                    {label}
                    <ChevronDown
                      size={13}
                      strokeWidth={2}
                      className={cn("transition-transform duration-150", activeDropdown === label && "rotate-180")}
                    />
                  </button>

                  {activeDropdown === label && (
                    <div
                      className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3"
                      onMouseEnter={handleDropdownEnter}
                      onMouseLeave={handleNavLeave}
                    >
                      <div className="w-[320px] bg-background border border-border rounded-[18px] p-1.5 flex flex-col gap-0.5 shadow-md">
                        {items.map(({ icon: Icon, title, desc, href: itemHref, tile, viewBox }) => (
                          <Link
                            key={title}
                            href={itemHref}
                            onClick={() => setActiveDropdown(null)}
                            className="flex items-center gap-2.5 px-2.5 py-2 rounded-[12px] transition-colors hover:bg-surface-hover"
                          >
                            <span className={cn("grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full leading-none", tile)}>
                              <HugeiconsIcon icon={Icon} size={15} strokeWidth={1.5} viewBox={viewBox} className="block" />
                            </span>
                            <span className="flex min-w-0 flex-col">
                              <span className="whitespace-nowrap text-[13px] font-medium leading-[1.3] text-foreground">{title}</span>
                              <span className="mt-0.5 whitespace-nowrap text-[12px] leading-[1.4] text-fg-muted">{desc}</span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </nav>

            <div className={cn("w-px h-5 mx-2", overDark ? "bg-white/20" : "bg-border")} />

            {userLoading ? null : user ? (
              <>
                <Link href="/workspace/home" className="inline-flex">
                  <Button design="pill" size="sm" className={overDark ? "bg-[#284B63] text-white hover:bg-[#3A6480]" : undefined}>My Account</Button>
                </Link>
              </>
            ) : (
              <>
                <Link href="/auth/login" className="inline-flex">
                  <Button design="pill-ghost" size="sm" className={overDark ? "text-white/80 hover:bg-white/10 hover:text-white" : undefined}>Log In</Button>
                </Link>
                <Link href="/auth/signup" className="inline-flex">
                  <Button design="pill" size="sm" className={overDark ? "bg-[#284B63] text-white hover:bg-[#3A6480] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]" : undefined}>Get Started</Button>
                </Link>
              </>
            )}
          </div>
          <div className="md:hidden flex items-center gap-2">
            {!user && !userLoading && (
              <Link href="/auth/signup" className="inline-flex">
                <Button design="pill" size="xs" className={overDark ? "bg-[#284B63] text-white hover:bg-[#3A6480]" : undefined}>Get Started</Button>
              </Link>
            )}
            <button
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg transition-colors bg-none border-none",
                overDark ? "text-white hover:bg-white/10" : "text-foreground hover:bg-surface-hover",
              )}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              <div className="relative w-4 h-[10px] flex flex-col justify-between">
                <span
                  className="block w-4 h-[2px] bg-current rounded-full transition-transform duration-300 ease-out origin-center"
                  style={{
                    transform: mobileMenuOpen
                      ? "translateY(4px) rotate(45deg)"
                      : "translateY(0) rotate(0deg)",
                  }}
                />
                <span
                  className="block w-4 h-[2px] bg-current rounded-full transition-transform duration-300 ease-out origin-center"
                  style={{
                    transform: mobileMenuOpen
                      ? "translateY(-4px) rotate(-45deg)"
                      : "translateY(0) rotate(0deg)",
                  }}
                />
              </div>
            </button>
          </div>
        </div>
      </div>
    </header>
  );

  const mobileMenuContent = mobileMenuOpen && (
    <div
      className="fixed left-0 right-0 bottom-0 z-50 md:hidden flex flex-col bg-background"
      style={{ top: "4rem" }}
    >
      <div className="flex-1 flex flex-col overflow-y-auto px-6 pt-4 pb-6">
        <nav className="flex flex-col flex-1">
          <div>
            {[
              { label: "Product", href: "/product" },
              { label: "Pricing", href: "/pricing" },
              { label: "CodeBot", href: "/codebot" },
              { label: "Resources", href: "/docs" },
            ].map(({ label, href }) => (
              <div key={label}>
                <Link
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between py-3.5 text-[15px] font-medium text-foreground border-b border-border/60"
                >
                  {label}
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              </div>
            ))}
            {user && (
              <div>
                <Link
                  href="/workspace/home"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between py-3.5 text-[15px] font-medium text-foreground border-b border-border/60"
                >
                  My Account
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              </div>
            )}
          </div>
          <div className="mt-auto pt-8">
            {userLoading ? null : user ? (
              <Button
                onClick={() => { logout.mutate(); setMobileMenuOpen(false); }}
                className="w-full"
              >
                Sign out
              </Button>
            ) : (
              <div className="flex flex-row gap-2">
                <Link href="/auth/login" onClick={() => setMobileMenuOpen(false)} className="flex-1">
                  <Button design="pill-ghost" size="sm" className="w-full max-md:h-10 max-md:px-5 max-md:text-[16px]">
                    Log In
                  </Button>
                </Link>
                <Link href="/auth/signup" onClick={() => setMobileMenuOpen(false)} className="flex-1">
                  <Button design="pill" size="sm" className="w-full max-md:h-10 max-md:px-5 max-md:text-[16px]">
                    Get Started
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {panel || fullWidth ? (
        <div className={cn("flex-1 flex flex-col w-full bg-background", !fullWidth && "max-w-[1280px] mx-auto")}>
          {headerContent}
          {mobileMenuContent}
          <main className="flex-1 w-full lds-marketing-main">
            {children}
          </main>
        </div>
      ) : (
        <>
          {headerContent}
          {mobileMenuContent}
          <main className="flex-1 w-full bg-background lds-marketing-main">
            {children}
          </main>
        </>
      )}

      {showFooter && (
        <footer className="mt-auto bg-background">
          <div className={cn("w-full px-6 md:px-10 border-t", !fullWidth && "max-w-[1280px] mx-auto")} style={{ borderColor: 'hsl(var(--border))' }}>
            <div className="pt-16 md:pt-20 pb-8">
              {/* ── Top: brand + link columns ── */}
              <div className="grid grid-cols-2 lg:grid-cols-12 gap-x-6 gap-y-12">
                <div className="col-span-2 lg:col-span-5 lg:pr-14">
                  <Link href="/" className="inline-flex items-center gap-2">
                    {logo ? (
                      <img src={logoSrc} alt="Cortardo" height={36} className="h-9 w-auto shrink-0" />
                    ) : (
                      <img src="/CortardoFull.svg?v=1" alt="Cortardo" height={36} className="h-9 w-auto shrink-0" />
                    )}
                  </Link>
                  <p className="mt-6 max-w-sm text-[13.5px] text-fg-muted font-medium leading-[1.75]">
                    Cortardo reviews every pull request with AI — catching bugs,
                    security issues, and style drift so your team can merge with confidence.
                  </p>
                  <div className="mt-7 flex items-center gap-2">
                    <Link
                      href="/status"
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-surface-subtle/60 hover:bg-surface-subtle transition-colors"
                    >
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                      <span className="text-[12px] font-medium text-fg-muted">All systems operational</span>
                    </Link>
                  </div>
                  <p className="mt-5 text-[12.5px] text-fg-muted font-medium">
                    Proudly built in the United Kingdom
                  </p>
                </div>

                {[
                  {
                    heading: "Product",
                    links: [["Product", "/product"], ["Features", "/#features"], ["Pricing", "/pricing"]],
                  },
                  {
                    heading: "Resources",
                    links: [["Documentation", "/docs"], ["Status", "/status"], ["Contact", "/contact"], ["Blog", "/blog"]],
                  },
                  {
                    heading: "Company",
                    links: [["Changelog", "/changelog"], ["Roadmap", "/roadmap"], ["Contact", "/contact"], ["Status", "/status"]],
                  },
                  {
                    heading: "Legal",
                    links: [["Privacy Policy", "/privacy"], ["Terms of Service", "/terms"]],
                  },
                ].map(({ heading, links }) => (
                  <div key={heading} className="col-span-1 lg:col-span-2">
                    <p className="text-[11px] font-bold tracking-[0.09em] text-fg-muted">{heading}</p>
                    <nav className="mt-5 flex flex-col gap-3.5">
                      {links.map(([label, href]) => (
                        href.startsWith('https://') ? (
                          <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="text-[13.5px] text-foreground/75 font-medium hover:text-foreground transition-colors">
                            {label}
                          </a>
                        ) : (
                          <Link key={label} href={href} className="text-[13.5px] text-foreground/75 font-medium hover:text-foreground transition-colors">
                            {label}
                          </Link>
                        )
                      ))}
                    </nav>
                  </div>
                ))}
              </div>

              {/* ── Bottom bar ── */}
              <div className="mt-16 pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
                <span className="text-[12.5px] font-medium text-muted-foreground">
                  &copy; {new Date().getFullYear()} Cortardo. All rights reserved.
                </span>
                <div className="flex items-center gap-7">
                  <Link href="/privacy" className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
                  <Link href="/terms" className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
                  <Link href="/contact" className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground transition-colors">Contact</Link>
                </div>
              </div>
            </div>
          </div>
        </footer>
      )}

      <CookieBar />
    </div>
  );
}
