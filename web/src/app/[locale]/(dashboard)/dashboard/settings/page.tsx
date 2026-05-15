"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeSwitch } from "@/components/settings/theme-switch";
import { FontSwitch } from "@/components/settings/font-switch";
import { cn } from "@/lib/utils";
import { usePlanContext } from "@/components/providers/plan-provider";
import { BillingSection } from "@/components/settings/billing-section";
import { TeamSection } from "@/components/settings/team-section";
import { ApiKeysSection } from "@/components/settings/api-keys-section";

type Section = "account" | "theme" | "project" | "team" | "api-keys" | "billing";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const { isCloud } = usePlanContext();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [active, setActive] = useState<Section>(
    tabParam === "billing" && isCloud ? "billing" : "account"
  );
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setDisplayName(u?.user_metadata?.full_name ?? "");
      setEmail(u?.email ?? "");
    });
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const navItems: { id: Section; label: string }[] = [
    { id: "account", label: t("account") },
    { id: "theme", label: t("theme") },
    { id: "project", label: t("project") },
    { id: "team", label: t("team") },
    { id: "api-keys", label: "API Keys" },
    ...(isCloud ? [{ id: "billing" as Section, label: t("billing") }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Separator />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sidebar nav */}
        <nav className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className={cn(
                "w-full text-left rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Main content — only active section shown */}
        <div className="lg:col-span-2">
          {/* Account */}
          {active === "account" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("account")}</CardTitle>
                <CardDescription>{t("accountDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t("displayName")}</Label>
                  <Input
                    id="name"
                    placeholder="Your name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">{t("email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={() => {}}
                    disabled
                  />
                </div>
                <Button>{t("save")}</Button>
                <Separator className="my-2" />
                <Button
                  variant="outline"
                  onClick={handleSignOut}
                  className="text-destructive hover:text-destructive"
                >
                  {tAuth("signOut")}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Theme */}
          {active === "theme" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t("theme")}</CardTitle>
                  <CardDescription>{t("themeDescription")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ThemeSwitch />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t("font")}</CardTitle>
                  <CardDescription>{t("fontDescription")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <FontSwitch />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Project */}
          {active === "project" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("project")}</CardTitle>
                <CardDescription>Configure your project settings.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="projectName">{t("projectName")}</Label>
                  <Input id="projectName" placeholder="My Brand" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="domain">{t("domain")}</Label>
                  <Input id="domain" placeholder="example.com" />
                </div>
                <Button>{t("save")}</Button>
              </CardContent>
            </Card>
          )}

          {/* Team */}
          {active === "team" && <TeamSection />}

          {/* API Keys */}
          {active === "api-keys" && <ApiKeysSection />}

          {/* Billing */}
          {active === "billing" && isCloud && <BillingSection />}
        </div>
      </div>
    </div>
  );
}
