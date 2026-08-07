import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { api, type CampaignSummary } from "@/lib/api";

interface HistorySearch {
  q?: string | undefined;
}

export const Route = createFileRoute("/history")({
  validateSearch: (search: Record<string, unknown>): HistorySearch => ({
    q: typeof search["q"] === "string" ? search["q"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Campaign History — Email Campaign Manager" },
      {
        name: "description",
        content:
          "Browse every email campaign you created, with sender, recipients and delivery status.",
      },
    ],
  }),
  component: HistoryPage,
});

const PAGE_SIZE = 10;

function HistoryPage() {
  const navigate = useNavigate();
  const { q } = Route.useSearch();
  const [term, setTerm] = useState(q ?? "");
  const [page, setPage] = useState(1);
  const [details, setDetails] = useState<CampaignSummary | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["campaigns", page, q],
    queryFn: () => api.listCampaigns({ page, pageSize: PAGE_SIZE, search: q }),
    placeholderData: keepPreviousData,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AppShell>
      <PageHeader
        title="Campaign History"
        description="Every campaign created from this account."
        actions={
          <Button asChild className="rounded-full px-6">
            <Link to="/create">New Campaign</Link>
          </Button>
        }
      />

      <form
        className="relative mb-5"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          navigate({ to: "/history", search: { q: term || undefined } });
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by subject"
          className="h-11 rounded-xl pl-9"
        />
      </form>

      {isLoading ? (
        <LoadingState label="Loading campaigns…" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No campaigns found"
          description="Create your first campaign to see it here."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Campaign Name (Subject)</TableHead>
                  <TableHead>Sender Name</TableHead>
                  <TableHead>Created Date</TableHead>
                  <TableHead className="text-right">Recipient Count</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((campaign) => (
                  <TableRow key={campaign.id} className="transition-colors hover:bg-accent/40">
                    <TableCell className="max-w-72 truncate font-medium">
                      {campaign.subject}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{campaign.senderName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(campaign.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {campaign.recipientCount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={campaign.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg"
                        onClick={() => setDetails(campaign)}
                      >
                        <Eye className="mr-1.5 size-3.5" /> View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 md:hidden">
            {data.items.map((campaign) => (
              <div
                key={campaign.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <p className="truncate font-semibold text-foreground">{campaign.subject}</p>
                  <StatusBadge status={campaign.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{campaign.senderName}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(campaign.createdAt).toLocaleDateString()} ·{" "}
                  {campaign.recipientCount.toLocaleString()} recipients
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 rounded-lg"
                  onClick={() => setDetails(campaign)}
                >
                  <Eye className="mr-1.5 size-3.5" /> View Details
                </Button>
              </div>
            ))}
          </div>

          {data.total > PAGE_SIZE && (
            <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <p className="truncate text-sm text-muted-foreground">
                Page {page} of {totalPages} · {data.total.toLocaleString()} campaigns
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={details !== null} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          {details && (
            <>
              <DialogHeader>
                <DialogTitle>{details.subject}</DialogTitle>
                <DialogDescription>Campaign details</DialogDescription>
              </DialogHeader>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Sender Name</dt>
                  <dd className="min-w-0 truncate font-medium">{details.senderName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Created Date</dt>
                  <dd className="font-medium">{new Date(details.createdAt).toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Recipient Count</dt>
                  <dd className="font-medium">{details.recipientCount.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Attachments</dt>
                  <dd className="font-medium">{details.attachmentCount}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <StatusBadge status={details.status} />
                  </dd>
                </div>
                {details.body && (
                  <div className="rounded-xl border border-border bg-muted/40 p-3">
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">Message</dt>
                    <dd className="max-h-48 overflow-y-auto whitespace-pre-wrap text-foreground">
                      {details.body}
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
