import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { PatternDemo } from "@/components/landing/pattern-demo";
import { DownloadCTA } from "@/components/landing/download-cta";

export default function Home() {
  return (
    <main className="relative min-h-screen bg-background">
      <Hero />
      <Features />
      <PatternDemo />

      {/* Trust signals */}
      <section className="border-t border-border/50 py-20">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Trusted by teams who ship
          </p>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              {
                quote: "We discovered 12 workflow patterns in the first week. Three are now automated.",
                author: "Engineering Lead",
                company: "Series B Startup",
              },
              {
                quote: "The skill packs export saved us weeks of manual documentation.",
                author: "Staff Engineer",
                company: "Growth-stage SaaS",
              },
              {
                quote: "Finally, a tool that understands how work actually flows across our tools.",
                author: "VP Engineering",
                company: "Enterprise Platform",
              },
            ].map((t) => (
              <div
                key={t.author}
                className="rounded-xl border border-border/50 bg-card p-6 text-left shadow-warm-card"
              >
                <p className="text-sm leading-relaxed text-muted-foreground">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="mt-4">
                  <p className="text-sm font-medium">{t.author}</p>
                  <p className="text-xs text-muted-foreground">{t.company}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <DownloadCTA />

      {/* Footer */}
      <footer className="border-t border-border/50 py-12">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <p className="font-display text-lg font-bold text-primary">
                Workflow Miner
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Discover, review, deploy.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold">Product</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>Dashboard</li>
                <li>Patterns</li>
                <li>Skills</li>
                <li>Connectors</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold">Company</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>About</li>
                <li>Blog</li>
                <li>Careers</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold">Legal</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>Privacy</li>
                <li>Terms</li>
                <li>Security</li>
              </ul>
            </div>
          </div>
          <div className="mt-10 border-t border-border/50 pt-6 text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Workflow Miner. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
