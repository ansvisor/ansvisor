"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";

function getMcpEndpoint(): string {
  const appUrl =
    configuredAppUrl ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${appUrl}/api/mcp`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const mcpEndpoint = getMcpEndpoint();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/keys");
      const body = (await res.json()) as { keys?: ApiKey[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load");
      setKeys(body.keys ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = (await res.json()) as {
        key?: ApiKey & { token: string };
        error?: string;
      };
      if (!res.ok || !body.key) throw new Error(body.error || "Failed to create");
      setRevealedToken(body.key.token);
      setNewName("");
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this API key? Clients using it will lose access immediately.")) {
      return;
    }
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to revoke");
      }
      toast.success("Key revoked");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke");
    }
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              API Keys
            </CardTitle>
            <CardDescription>
              Long-lived tokens for the Ansvisor MCP server and other external
              clients. Keys are shown once at creation — store them somewhere safe.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" />
            New key
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1.5">
          <p className="font-medium text-foreground">MCP endpoint</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate font-mono">
              {mcpEndpoint}
            </code>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              onClick={() => copy(mcpEndpoint)}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-muted-foreground">
            Paste this URL + a key below into Claude Desktop / Claude Code /
            Cursor. See the{" "}
            <a
              href="https://github.com/aeohub/ansvisor#whats-next"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              MCP guide
            </a>
            .
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No API keys yet. Create one to connect the MCP server.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {keys.map((k) => {
              const revoked = !!k.revoked_at;
              return (
                <div
                  key={k.id}
                  className="flex items-center justify-between gap-4 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{k.name}</p>
                      {revoked && (
                        <Badge variant="outline" className="text-[10px]">
                          revoked
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      {k.prefix}…
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Created {formatDate(k.created_at)} · Last used{" "}
                      {formatDate(k.last_used_at)}
                    </p>
                  </div>
                  {!revoked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(k.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              Give this key a memorable name (e.g. &quot;MCP — my laptop&quot;).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="apiKeyName">Name</Label>
            <Input
              id="apiKeyName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="MCP — local"
              autoFocus
              disabled={creating}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={creating} />}>
              Cancel
            </DialogClose>
            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!revealedToken}
        onOpenChange={(v) => !v && setRevealedToken(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key</DialogTitle>
            <DialogDescription>
              You won&apos;t be able to see this again. Store it somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 font-mono text-xs">
              <code className="flex-1 truncate">{revealedToken}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revealedToken && copy(revealedToken)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedToken(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
