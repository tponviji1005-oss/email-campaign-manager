import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  sending: "bg-warning/15 text-warning border-warning/30",
  sent: "bg-success/10 text-success border-success/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

export function StatusBadge({ status }: { status: string }) {
  const key = status?.toLowerCase?.() ?? "";
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-3 py-0.5 font-medium capitalize",
        styles[key] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </Badge>
  );
}
