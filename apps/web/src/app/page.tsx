import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { PatternDemo } from "@/components/landing/pattern-demo";

export default function Home() {
  return (
    <main className="relative min-h-screen bg-background">
      <Hero />
      <Features />
      <PatternDemo />

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 text-center text-sm text-muted-foreground">
        <p>Workflow Miner — discover, review, deploy.</p>
      </footer>
    </main>
  );
}
