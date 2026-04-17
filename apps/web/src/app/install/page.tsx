import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Install — Workflow Miner",
  description:
    "How to bypass macOS Gatekeeper when installing unsigned Workflow Miner alpha builds.",
};

export default function InstallPage() {
  return (
    <main className="relative min-h-screen bg-background">
      <section className="mx-auto max-w-2xl px-4 py-20">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Install Workflow Miner
        </h1>

        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          Workflow Miner alpha builds are unsigned. Here&apos;s the 30-second
          workaround for macOS Gatekeeper.
        </p>

        <ol className="mt-10 space-y-6">
          <li className="flex gap-4">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
              1
            </span>
            <p className="pt-1 leading-relaxed">
              Download the <code className="rounded bg-muted px-1.5 py-0.5 text-sm">.dmg</code>{" "}
              from the latest release.
            </p>
          </li>

          <li className="flex gap-4">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
              2
            </span>
            <p className="pt-1 leading-relaxed">
              Double-click to mount and drag Workflow Miner into Applications.
            </p>
          </li>

          <li className="flex gap-4">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
              3
            </span>
            <p className="pt-1 leading-relaxed">
              <strong className="font-semibold">First launch only</strong>: open
              Applications in Finder,{" "}
              <strong className="font-semibold">
                right-click the Workflow Miner icon
              </strong>
              , choose <strong className="font-semibold">Open</strong>, then
              click <strong className="font-semibold">Open</strong> in the
              warning dialog. Subsequent launches work normally.
            </p>
          </li>

          <li className="flex gap-4">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
              4
            </span>
            <div className="pt-1 leading-relaxed">
              <p>
                If macOS says &ldquo;damaged and can&apos;t be opened&rdquo;, run
                in Terminal:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-border/50 bg-muted p-4 text-sm">
                <code>xattr -d com.apple.quarantine &quot;/Applications/Workflow Miner.app&quot;</code>
              </pre>
              <p className="mt-2 text-sm text-muted-foreground">
                This removes the quarantine flag Safari/Slack/AirDrop set on the
                download.
              </p>
            </div>
          </li>

          <li className="flex gap-4">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
              5
            </span>
            <p className="pt-1 leading-relaxed">
              If macOS says &ldquo;cannot be opened because the developer cannot
              be verified&rdquo;, close the dialog and do the right-click Open in
              step 3 instead.
            </p>
          </li>
        </ol>

        <div className="mt-16 rounded-xl border border-border/50 bg-card p-6 shadow-warm-card">
          <h2 className="font-display text-xl font-semibold tracking-tight">
            Why?
          </h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            We ship signed + notarized builds for the production release. Alpha
            builds skip the Apple Developer signing step to iterate faster with
            early testers.
          </p>
        </div>

        <div className="mt-12">
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            &larr; Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}
