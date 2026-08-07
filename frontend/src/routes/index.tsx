import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowRight, CheckCircle2, Gauge, Megaphone, Send } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import heroImage from "@/assets/hero-dashboard.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Email Campaign Manager" },
      {
        name: "description",
        content:
          "Quick summary of your bulk email campaigns: totals, emails sent and success rate.",
      },
      { property: "og:title", content: "Dashboard — Email Campaign Manager" },
      {
        property: "og:description",
        content: "Create, validate and send bulk email campaigns securely.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const stats = useQuery({ queryKey: ["dashboard-stats"], queryFn: api.getDashboardStats });
  const recent = useQuery({
    queryKey: ["campaigns", "recent"],
    queryFn: () => api.listCampaigns({ page: 1, pageSize: 5 }),
  });

  return (
    <AppShell>
      <PageHeader title="Dashboard" description="A quick summary of your email campaigns." />

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative overflow-hidden rounded-3xl border border-border bg-accent/60 p-6 shadow-[var(--shadow-soft)] sm:p-10"
      >
        <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr]">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
              <Megaphone className="size-3.5" /> Campaign platform
            </span>
            <h2 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
              Email Campaign Manager
            </h2>
            <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
              Create, validate and send bulk email campaigns securely.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full px-6">
                <Link to="/create">
                  Create Campaign <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full bg-card px-6">
                <Link to="/history">Campaign History</Link>
              </Button>
            </div>
          </div>
          <img
            src={heroImage}
            alt="Illustration of email campaign delivery status panels"
            width={1024}
            height={896}
            className="mx-auto w-full max-w-lg"
          />
        </div>
      </motion.section>

      {stats.isError ? (
        <div className="mt-8">
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        </div>
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total Campaigns"
            value={stats.data?.totalCampaigns ?? 0}
            icon={Megaphone}
            loading={stats.isLoading}
          />
          <StatCard
            label="Emails Sent"
            value={stats.data?.emailsSent ?? 0}
            icon={Send}
            loading={stats.isLoading}
          />
          <StatCard
            label="Valid Recipients"
            value={stats.data?.validRecipients ?? 0}
            icon={CheckCircle2}
            tone="success"
            loading={stats.isLoading}
          />
          <StatCard
            label="Success Rate"
            value={stats.data?.successRate ?? 0}
            icon={Gauge}
            suffix="%"
            decimals={1}
            loading={stats.isLoading}
          />
        </div>
      )}

      <div className="mb-4 mt-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className="truncate text-lg font-semibold text-foreground">Recent campaigns</h3>
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link to="/history">View all</Link>
        </Button>
      </div>

      {recent.isLoading ? (
        <LoadingState label="Loading campaigns…" />
      ) : recent.isError ? (
        <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
      ) : !recent.data || recent.data.items.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Create your first campaign to see it here."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Campaign Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Created Date</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.data.items.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium">{campaign.name}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">
                    {campaign.subject}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(campaign.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {campaign.recipientCount.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={campaign.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
