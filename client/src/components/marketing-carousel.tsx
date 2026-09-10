import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { Inbox, Bot, Globe, TrendingUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const slides = [
  {
    icon: Inbox,
    title: "Unified Inbox",
    description:
      "Email, live chat, and social — all in one place. Every conversation lands in a shared queue your team can action together.",
  },
  {
    icon: Bot,
    title: "AI-powered replies",
    description:
      "Suggest responses, auto-tag tickets, and surface knowledge base articles before your agent even starts typing.",
  },
  {
    icon: Globe,
    title: "Custom Domain",
    description:
      "Full DNS verification, BIMI support, and custom domain sending — so your emails always land in the inbox, not spam.",
  },
  {
    icon: TrendingUp,
    title: "Ticket Tracking",
    description:
      "Track every ticket from open to resolved. Filter by status, inbox, and sender with full tracking dashboards.",
  },
  {
    icon: Zap,
    title: "Automation Rules",
    description:
      "Route tickets by keyword, priority, or team. Auto-close resolved conversations and send follow-ups — no code needed.",
  },
];

export function MarketingCarousel() {
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, align: "center" },
    [Autoplay({ delay: 5000, stopOnMouseEnter: true, stopOnInteraction: false })],
  );

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    setScrollSnaps(emblaApi.scrollSnapList());
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  return (
    <section className="w-full py-14 md:py-20 border-t border-border">
      <div className="px-6 md:px-8 max-w-[1280px] mx-auto">
        <div className="overflow-hidden rounded-2xl" ref={emblaRef}>
          <div className="flex">
            {slides.map(({ icon: Icon, title, description }, i) => (
              <div
                key={title}
                className="flex-[0_0_85%] md:flex-[0_0_45%] lg:flex-[0_0_30%] min-w-0 pl-4 md:pl-6 first:ml-4 md:first:ml-6"
              >
                <div
                  className={cn(
                    "h-full p-6 md:p-8 rounded-2xl border transition-colors duration-300",
                    i === selectedIndex
                      ? "border-border bg-surface-muted/60"
                      : "border-border/40 bg-transparent",
                  )}
                >
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand/10 text-brand mb-4">
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-[16px] font-semibold text-foreground tracking-[-0.01em] mb-2">
                    {title}
                  </h3>
                  <p className="text-[13px] text-fg-muted font-medium leading-[1.65]">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 mt-8">
          {scrollSnaps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => emblaApi?.scrollTo(i)}
              className={cn(
                "rounded-full transition-all duration-300 bg-none border-none cursor-pointer",
                i === selectedIndex
                  ? "w-6 h-1.5 bg-foreground"
                  : "w-1.5 h-1.5 bg-border hover:bg-fg-muted",
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
