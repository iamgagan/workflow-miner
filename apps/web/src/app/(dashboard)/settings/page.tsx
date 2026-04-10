import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <Settings className="h-12 w-12 text-muted-foreground" />
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-muted-foreground">
        Account and application settings will appear here.
      </p>
    </div>
  );
}
