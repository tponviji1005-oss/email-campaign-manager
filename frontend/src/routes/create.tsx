import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
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
  TriangleAlert,
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

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "rtf",
  "odt",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
] as const;

const ACCEPT = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return ImageIcon;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return FileArchive;
  return FileText;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The backend parses recipients separated by newlines and commas. Normalize
// semicolons to commas so the existing endpoint treats them as separators too.
function normalizeSeparators(raw: string) {
  return raw.replace(/;/g, ",");
}

// Count the tokens exactly the way the backend will split them, so duplicate
// counts are consistent with the parse endpoint's result.
function countEmails(raw: string) {
  return normalizeSeparators(raw)
    .split(/[\n,]+/)
    .map((value) => value.trim())
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
  children: ReactNode;
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
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [touched, setTouched] = useState({
    senderName: false,
    subject: false,
    body: false,
  });

  const errors = {
    senderName: touched.senderName && !senderName.trim() ? "Sender name is required." : undefined,
    subject: touched.subject && !subject.trim() ? "Subject is required." : undefined,
    body: touched.body && !body.trim() ? "Email content is required." : undefined,
  };

  const totalEntered = countEmails(recipientsRaw);
  const duplicateCount = parsed
    ? Math.max(0, totalEntered - parsed.totalValid - parsed.totalInvalid)
    : 0;
  const canSend = Boolean(
    parsed && parsed.totalValid > 0 && senderName.trim() && subject.trim() && body.trim(),
  );

  const missingItems: string[] = [];
  if (!senderName.trim()) missingItems.push("sender name");
  if (!subject.trim()) missingItems.push("subject");
  if (!body.trim()) missingItems.push("email content");
  if (!parsed || parsed.totalValid === 0) missingItems.push("at least one validated recipient");

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    Array.from(incoming).forEach((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
        rejected.push(`${file.name}: unsupported file type`);
      } else if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name}: exceeds the 10 MB limit`);
      } else {
        accepted.push(file);
      }
    });
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
    if (rejected.length > 0) toast.error(rejected.join(" · "));
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const validate = async () => {
    if (!recipientsRaw.trim()) {
      setValidationError("Add at least one recipient email first.");
      return;
    }
    setValidating(true);
    setValidationError(null);
    try {
      const result = await api.parseRecipients(normalizeSeparators(recipientsRaw));
      setParsed(result);
      toast.success(`${result.totalValid} valid, ${result.totalInvalid} invalid`);
    } catch (err) {
      setParsed(null);
      const message = err instanceof Error ? err.message : "Validation request failed.";
      setValidationError(message);
      toast.error(message);
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
    setValidationError(null);
    setTouched({ senderName: false, subject: false, body: false });
  };

  const reset = () => {
    clearForm();
    toast.success("Form reset");
  };

  const handleSendClick = () => {
    if (!canSend) {
      setTouched({ senderName: true, subject: true, body: true });
      toast.error(`Cannot send yet: ${missingItems.join(", ")}.`);
      return;
    }
    setConfirmOpen(true);
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
            <Label htmlFor="senderName">
              Sender Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="senderName"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, senderName: true }))}
              placeholder="Acme Communications"
              aria-invalid={Boolean(errors.senderName)}
              aria-describedby={errors.senderName ? "senderName-error" : undefined}
              className="h-11 rounded-xl"
            />
            {errors.senderName && (
              <p id="senderName-error" className="text-xs text-destructive">
                {errors.senderName}
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard step={2} title="Email Subject">
          <div className="space-y-2">
            <Label htmlFor="subject">
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, subject: true }))}
              placeholder="Your monthly product update"
              aria-invalid={Boolean(errors.subject)}
              aria-describedby={errors.subject ? "subject-error" : undefined}
              className="h-11 rounded-xl"
            />
            {errors.subject && (
              <p id="subject-error" className="text-xs text-destructive">
                {errors.subject}
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard step={3} title="Email Draft">
          <div className="space-y-2">
            <Label htmlFor="body">
              Message <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, body: true }))}
              placeholder="Write your email content…"
              aria-invalid={Boolean(errors.body)}
              aria-describedby={errors.body ? "body-error" : undefined}
              className="min-h-72 rounded-xl"
            />
            {errors.body && (
              <p id="body-error" className="text-xs text-destructive">
                {errors.body}
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard
          step={4}
          title="Attachments"
          description="Optional. Images, PDF, DOC/DOCX, ZIP and other common email files, up to 10 MB each. Files are attached when the campaign is sent."
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
            <p className="mt-1 text-xs text-muted-foreground">
              PNG, JPG, PDF, DOC/DOCX, ZIP, TXT, CSV and more
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
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
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeFile(index)}
                    >
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
          description="Enter one email, or paste a bulk list (100–2,000 addresses) separated by commas, semicolons or new lines."
        >
          <Textarea
            value={recipientsRaw}
            onChange={(e) => {
              setRecipientsRaw(e.target.value);
              setParsed(null);
              setValidationError(null);
            }}
            placeholder={"name@company.com\nanother@company.com, third@company.com"}
            className="mt-3 min-h-56 rounded-xl font-mono text-xs"
          />

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => void validate()}
              disabled={validating || !recipientsRaw.trim()}
              className="h-11 rounded-xl px-6"
            >
              {validating && <Loader2 className="mr-2 size-4 animate-spin" />}
              {validating ? "Validating…" : "Validate Recipients"}
            </Button>
            <Button variant="ghost" className="h-11 rounded-xl" onClick={reset}>
              <RotateCcw className="mr-2 size-4" /> Reset
            </Button>
          </div>

          {validationError && (
            <p className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <XCircle className="size-4 shrink-0" />
              {validationError}
            </p>
          )}

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
                <p className="text-xs font-medium text-muted-foreground">Total Recipients</p>
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
          {parsed && parsed.totalInvalid > 0 && (
            <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                {parsed.totalInvalid.toLocaleString()} invalid recipient
                {parsed.totalInvalid === 1 ? "" : "s"} will be excluded. Only valid recipients will
                receive this campaign.
              </span>
            </p>
          )}

          <Button className="h-11 w-full rounded-xl" disabled={sending} onClick={handleSendClick}>
            {sending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            {sending ? "Sending…" : "Send Campaign"}
          </Button>
          {!canSend && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Missing: {missingItems.join(", ")}.
            </p>
          )}
          {canSend && parsed && (
            <p className="mt-3 text-center text-sm font-medium text-success">
              Ready to send to {parsed.totalValid.toLocaleString()} valid recipient
              {parsed.totalValid === 1 ? "" : "s"}.
            </p>
          )}
        </SectionCard>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send this campaign?</DialogTitle>
            <DialogDescription>
              {parsed ? (
                <>
                  Ready to send to{" "}
                  <span className="font-semibold text-foreground">
                    {parsed.totalValid.toLocaleString()} valid recipient
                    {parsed.totalValid === 1 ? "" : "s"}
                  </span>
                  {parsed.totalInvalid > 0
                    ? ` — ${parsed.totalInvalid.toLocaleString()} invalid recipient${
                        parsed.totalInvalid === 1 ? "" : "s"
                      } will be excluded.`
                    : "."}
                </>
              ) : (
                "The backend will queue and deliver these emails."
              )}
            </DialogDescription>
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
