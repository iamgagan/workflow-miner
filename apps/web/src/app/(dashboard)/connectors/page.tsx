import { Plug } from "lucide-react";

export default function ConnectorsPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <Plug className="h-12 w-12 text-muted-foreground" />
      <h1 className="text-2xl font-bold">Connectors</h1>
      <p className="text-muted-foreground">
        Configure your Gmail, Slack, Linear, and Calendar integrations here.
      </p>
    </div>
  );
}
