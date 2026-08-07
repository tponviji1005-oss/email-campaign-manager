import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  CheckCircle2,
  FileArchive,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  RotateCcw,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type ParsedRecipients } from "@/lib/api";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create Campaign — Email Campaign Manager" },
      {
        name: "description",
        content:
          "Compose a bulk email campaign with sender details, attachments and a validated recipient list.",
      },
    ],
  }),
  component: CreateCampaignPage,
});

const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.zip";

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext ?? "")) return ImageIcon;
  if (ext === "zip") return FileArchive;
  return FileText;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function countEmails(raw: string) {
  return raw
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean).length;
}

function SectionCard({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
      <div className="flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function CreateCampaignPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [senderName, setSenderName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedRecipients | null>(null);
  const [validating, setValidating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const totalEntered = countEmails(recipientsRaw);
  const duplicateCount = parsed
    ? Math.max(0, totalEntered - parsed.totalValid - parsed.totalInvalid)
    : 0;
  const canSend = Boolean(parsed && parsed.totalValid > 0 && senderName.trim() && subject.trim());

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setFiles((prev) => [...prev, ...Array.from(incoming)]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const validate = async () => {
    if (!recipientsRaw.trim()) {
      toast.error("Add at least one recipient email first.");
      return;
    }
    setValidating(true);
    try {
      const result = await api.parseRecipients(recipientsRaw);
      setParsed(result);
      toast.success(`${result.totalValid} valid, ${result.totalInvalid} invalid`);
    } catch (err) {
      setParsed(null);
      toast.error(err instanceof Error ? err.message : "Validation request failed.");
    } finally {
      setValidating(false);
    }
  };

  const clearForm = () => {
    setSenderName("");
    setSubject("");
    setBody("");
    setFiles([]);
    setRecipientsRaw("");
    setParsed(null);
  };

  const reset = () => {
    clearForm();
    toast.success("Form reset");
  };

  const send = async () => {
    if (!parsed || !canSend) return;
    setSending(true);
    try {
      await api.sendCampaign({
        senderName,
        subject,
        body,
        recipients: parsed.validRecipients,
        attachments: files,
      });
      setConfirmOpen(false);
      clearForm();
      toast.success("Campaign sent successfully");
      navigate({ to: "/history" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the campaign.");
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Create Campaign"
        description="Compose your email, attach files, add recipients and validate before sending."
      />

      <div className="mx-auto grid max-w-3xl gap-6">
        <SectionCard step={1} title="Sender Information">
          <div className="space-y-2">
            <Label htmlFor="senderName">Sender Name</Label>
            <Input
              id="senderName"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Acme Communications"
              className="h-11 rounded-xl"
            />
          </div>
        </SectionCard>

        <SectionCard step={2} title="Email Subject">
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Your monthly product update"
              className="h-11 rounded-xl"
            />
          </div>
        </SectionCard>

        <SectionCard step={3} title="Email Draft">
          <div className="space-y-2">
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your email content…"
              className="min-h-56 rounded-xl"
            />
          </div>
        </SectionCard>

        <SectionCard
          step={4}
          title="Attachments"
          description="Images, PDF, DOCX and ZIP are supported."
        >
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-accent/40"
            }`}
          >
            <Paperclip className="mx-auto size-6 text-primary" />
            <p className="mt-3 text-sm font-medium text-foreground">
              Drop files here or click to upload
            </p>
            <p className="mt-1 text-xs text-muted-foreground">PNG, JPG, PDF, DOCX, ZIP</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {files.map((file, index) => {
                const Icon = fileIcon(file.name);
                return (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeFile(index)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          step={5}
          title="Recipients"
          description="Enter a single email, or paste a list separated by commas or new lines."
        >
          <Textarea
            value={recipientsRaw}
            onChange={(e) => {
              setRecipientsRaw(e.target.value);
              setParsed(null);
            }}
            placeholder={"name@company.com\nanother@company.com, third@company.com"}
            className="mt-3 min-h-56 rounded-xl font-mono text-xs"
          />

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => void validate()}
              disabled={validating}
              className="h-11 rounded-xl px-6"
            >
              {validating && <Loader2 className="mr-2 size-4 animate-spin" />}
              Validate
            </Button>
            <Button variant="ghost" className="h-11 rounded-xl" onClick={reset}>
              <RotateCcw className="mr-2 size-4" /> Reset
            </Button>
          </div>

          {parsed && (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-success/20 bg-success/10 p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-success/15 text-success">
                    <CheckCircle2 className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Valid Emails</p>
                    <p className="text-3xl font-bold text-foreground">
                      {parsed.totalValid.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="mt-4 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {parsed.validRecipients.map((email) => (
                    <div
                      key={email}
                      className="rounded-lg bg-card/70 px-3 py-2 font-mono text-xs text-foreground"
                    >
                      {email}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-destructive/15 text-destructive">
                    <XCircle className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Invalid Emails</p>
                    <p className="text-3xl font-bold text-foreground">
                      {parsed.totalInvalid.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="mt-4 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {parsed.invalidRecipients.map((email) => (
                    <div
                      key={email}
                      className="rounded-lg bg-card/70 px-3 py-2 font-mono text-xs text-foreground"
                    >
                      {email}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {parsed && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-background p-4 text-center">
                <p className="text-xs font-medium text-muted-foreground">Total Emails</p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {totalEntered.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background p-4 text-center">
                <p className="text-xs font-medium text-muted-foreground">Valid Emails</p>
                <p className="mt-1 text-2xl font-bold text-success">
                  {parsed.totalValid.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background p-4 text-center">
                <p className="text-xs font-medium text-muted-foreground">Invalid Emails</p>
                <p className="mt-1 text-2xl font-bold text-destructive">
                  {parsed.totalInvalid.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background p-4 text-center">
                <p className="text-xs font-medium text-muted-foreground">Duplicate Emails</p>
                <p className="mt-1 text-2xl font-bold text-muted-foreground">
                  {duplicateCount.toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard step={6} title="Send Campaign">
          {parsed && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-background p-4 text-center">
                <p className="text-xs font-medium text-muted-foreground">Total Valid Recipients</p>
                <p className="mt-1 text-2xl font-bold text-success">
                  {parsed.totalValid.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background p-4 text-center">
                <p className="text-xs font-medium text-muted-foreground">
                  Total Invalid Recipients
                </p>
                <p className="mt-1 text-2xl font-bold text-destructive">
                  {parsed.totalInvalid.toLocaleString()}
                </p>
              </div>
            </div>
          )}
          <Button
            className="h-11 w-full rounded-xl"
            disabled={!canSend}
            onClick={() => setConfirmOpen(true)}
          >
            <Send className="mr-2 size-4" /> Send Campaign
          </Button>
          {!canSend && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Validate at least one valid recipient, and fill in sender name and subject to send.
            </p>
          )}
        </SectionCard>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send this campaign?</DialogTitle>
            <DialogDescription>The backend will queue and deliver these emails.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-3 rounded-xl border border-border bg-muted/40 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Sender Name</dt>
              <dd className="min-w-0 truncate font-medium">{senderName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Subject</dt>
              <dd className="min-w-0 truncate font-medium">{subject}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Valid Recipients</dt>
              <dd className="font-medium">{parsed ? parsed.totalValid.toLocaleString() : 0}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Attachments</dt>
              <dd className="font-medium">{files.length}</dd>
            </div>
          </dl>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setConfirmOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button className="rounded-xl" onClick={() => void send()} disabled={sending}>
              {sending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
