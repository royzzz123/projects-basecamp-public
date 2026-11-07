import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  UserCog,
  UserStar,
  Notification01Icon,
  Calendar01Icon,
  Table,
  AlertDiamondIcon,
  Repeat,
  Clock01Icon,
  MailOpen,
  UserAdd01Icon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useUser } from "@/context/UserContext";
import { signup } from "@/lib/api";
import { getToken } from "@/lib/api";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — OnFinance AI" },
      { name: "description", content: "Manage your profile and preferences." },
    ],
  }),
  component: SettingsPage,
});

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{description}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  icon,
  label,
  description,
  defaultChecked,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </span>
        <div>
          <div className="text-[13px] font-medium text-foreground">{label}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{description}</div>
        </div>
      </div>
      <Switch defaultChecked={defaultChecked} />
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  developer: "Developer",
  admin: "Admin",
  business_user: "Business User",
};

const ROLE_BADGE: Record<string, string> = {
  developer: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  business_user: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

function initials(email: string) {
  const parts = email.split("@")[0].split(/[._-]/);
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || email[0].toUpperCase()
  );
}

function AddMemberForm() {
  const { user } = useUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"developer" | "admin" | "business_user">("business_user");
  const [orgId, setOrgId] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; orgId?: string }>({});

  const isDev = user?.role === "developer";

  const availableRoles = isDev
    ? [
        { value: "developer", label: "Developer" },
        { value: "admin", label: "Admin" },
        { value: "business_user", label: "Business User" },
      ]
    : [{ value: "business_user", label: "Business User" }];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: typeof errors = {};
    if (!email) newErrors.email = "Email is required";
    if (!password) newErrors.password = "Password is required";
    else if (password.length < 12) newErrors.password = "Must be at least 12 characters";
    if (isDev && role !== "developer" && !orgId.trim()) newErrors.orgId = "Org ID is required";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setLoading(true);
    try {
      await signup({
        email,
        password,
        role: role as "developer" | "admin" | "business_user",
        ...(isDev && role !== "developer" && orgId ? { org_id: orgId.trim() } : {}),
      });
      toast.success(`User ${email} created successfully`);
      setEmail("");
      setPassword("");
      setOrgId("");
      setRole("business_user");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create user";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-email" className="text-[12px]">
            Email
          </Label>
          <Input
            id="new-email"
            type="email"
            placeholder="user@company.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((p) => ({ ...p, email: undefined }));
            }}
            className={`h-8 text-[13px] ${errors.email ? "border-destructive" : ""}`}
          />
          {errors.email && <p className="text-[11px] text-destructive">{errors.email}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password" className="text-[12px]">
            Password <span className="text-muted-foreground font-normal">(min. 12 chars)</span>
          </Label>
          <Input
            id="new-password"
            type="password"
            placeholder="Min. 12 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((p) => ({ ...p, password: undefined }));
            }}
            className={`h-8 text-[13px] ${errors.password ? "border-destructive" : ""}`}
          />
          {errors.password && <p className="text-[11px] text-destructive">{errors.password}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-role" className="text-[12px]">
            Role
          </Label>
          <Select
            value={role}
            onValueChange={(v) => {
              setRole(v as typeof role);
              setErrors({});
            }}
          >
            <SelectTrigger id="new-role" className="h-8 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableRoles.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isDev && role !== "developer" && (
          <div className="space-y-1.5">
            <Label htmlFor="new-org" className="text-[12px]">
              Org ID
            </Label>
            <Input
              id="new-org"
              placeholder="MongoDB ObjectID"
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setErrors((p) => ({ ...p, orgId: undefined }));
              }}
              className={`h-8 text-[13px] font-mono ${errors.orgId ? "border-destructive" : ""}`}
            />
            {errors.orgId && <p className="text-[11px] text-destructive">{errors.orgId}</p>}
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="h-8 px-4 text-xs gap-1.5" disabled={loading}>
          <HugeiconsIcon icon={UserAdd01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />
          {loading ? "Creating…" : "Create user"}
        </Button>
      </div>
    </form>
  );
}

function SettingsPage() {
  const { user } = useUser();
  const router = useRouter();
  const isAdminOrDev = user?.role === "admin" || user?.role === "developer";

  if (!isAdminOrDev) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <HugeiconsIcon
          icon={Shield01Icon}
          className="mx-auto h-8 w-8 text-destructive/60 mb-3"
          strokeWidth={1.5}
        />
        <h2 className="font-semibold text-destructive">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Settings are only available to admin and developer roles.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.history.back()}>
          Go back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Profile */}
      <Section
        icon={<HugeiconsIcon icon={UserStar} className="h-3.5 w-3.5" strokeWidth={1.5} />}
        title="Profile"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar className="h-14 w-14 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary text-base font-semibold">
              {user ? initials(user.email) : "…"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[12px]">
                  Email
                </Label>
                <Input
                  id="email"
                  defaultValue={user?.email ?? ""}
                  type="email"
                  className="h-8 text-[13px]"
                  readOnly
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Role</Label>
                <div className="flex h-8 items-center">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${ROLE_BADGE[user?.role ?? ""] ?? ""}`}
                  >
                    {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Members — admin/developer only */}
      <Section
        icon={<HugeiconsIcon icon={UserAdd01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />}
        title="Add member"
      >
        <p className="mb-4 text-[12px] text-muted-foreground">
          Create a new account. Admins can create business users within their org. Developers can
          create any role.
        </p>
        <AddMemberForm />
      </Section>

      {/* Preferences */}
      <Section
        icon={<HugeiconsIcon icon={UserCog} className="h-3.5 w-3.5" strokeWidth={1.5} />}
        title="Preferences"
      >
        <div className="space-y-4">
          <Row label="Default time range" description="The range used when you open the dashboard.">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Calendar01Icon}
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <Select defaultValue="30">
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Row>
          <Separator />
          <Row label="Table density" description="Compact tables show more rows on screen.">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Table}
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <Select defaultValue="comfortable">
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Row>
        </div>
      </Section>

      {/* Notifications */}
      <Section
        icon={<HugeiconsIcon icon={Notification01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />}
        title="Notification preferences"
      >
        <div className="space-y-4">
          <Toggle
            icon={
              <HugeiconsIcon icon={AlertDiamondIcon} className="h-3.5 w-3.5" strokeWidth={1.5} />
            }
            label="Complaint spikes"
            description="Sudden surge in complaints for any entity."
            defaultChecked
          />
          <Separator />
          <Toggle
            icon={<HugeiconsIcon icon={Repeat} className="h-3.5 w-3.5" strokeWidth={1.5} />}
            label="Recurring patterns"
            description="Same sub-category repeats for a single entity."
            defaultChecked
          />
          <Separator />
          <Toggle
            icon={<HugeiconsIcon icon={Clock01Icon} className="h-3.5 w-3.5" strokeWidth={1.5} />}
            label="Unresolved breaches"
            description="Complaint open beyond resolution timeline."
            defaultChecked
          />
          <Separator />
          <Toggle
            icon={<HugeiconsIcon icon={MailOpen} className="h-3.5 w-3.5" strokeWidth={1.5} />}
            label="Daily email digest"
            description="A summary of activity once a day."
          />
        </div>
      </Section>
    </div>
  );
}
