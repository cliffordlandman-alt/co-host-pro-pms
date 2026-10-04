import { ContactEditor } from "@/components/ContactEditor";
import { SuggestedOwners } from "@/components/SuggestedOwners";
import { AutoStatementsSettings } from "@/components/AutoStatementsSettings";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect } from "react";
import { useGetOwners, useGetProperties } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Mail, KeyRound, CheckCircle2, AlertCircle, RefreshCw, Users } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const fj = async (url: string, opts?: RequestInit) => {
  const res = await apiFetch(`${API_BASE}${url}`, opts);
  const json = await res.json();
  if (!res.ok) throw json;
  return json;
};

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, Math.min(3, local.length))}***@${domain}`;
}

function ResetAccessDialog({ owner, open, onClose }: { owner: any; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);

  const resetMutation = useMutation({
    mutationFn: () => fj("/api/owner-auth/admin-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: owner.id }),
    }),
    onSuccess: (data) => {
      setSent(true);
      setEmailed(!!data.emailSent);
      if (data.devCode) setDevCode(data.devCode);
      toast({ title: data.emailSent ? `Access code emailed to ${owner.name}` : `Access code created for ${owner.name}. Nothing was sent.` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to send code", description: err.message, variant: "destructive" });
    },
  });

  function handleClose() {
    setSent(false);
    setDevCode(null);
    setEmailed(false);
    onClose();
  }

  if (!owner) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-teal-600" />
            Reset Portal Access
          </DialogTitle>
          <DialogDescription>
            Create a fresh portal access code for this owner. It is emailed only if outgoing messages are switched on; otherwise it is shown here for you to share yourself.
          </DialogDescription>
        </DialogHeader>

        {!sent ? (
          <div className="space-y-4">
            <div className="bg-muted/40 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Owner</span>
                <span className="font-medium">{owner.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Email on file</span>
                {owner.email ? (
                  <span className="font-medium font-mono text-xs">{maskEmail(owner.email)}</span>
                ) : (
                  <span className="text-destructive text-xs flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> No email set
                  </span>
                )}
              </div>
            </div>

            {!owner.email && (
              <p className="text-sm text-destructive text-center">
                Add an email address to this owner before sending an access code.
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                disabled={!owner.email || resetMutation.isPending}
                onClick={() => resetMutation.mutate()}
              >
                {resetMutation.isPending ? (
                  <><RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />Creating…</>
                ) : (
                  <><KeyRound className="h-3.5 w-3.5 mr-2" />Create code</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            </div>
            <div>
              <p className="font-semibold">{emailed ? "Code emailed" : "Code created"}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {emailed ? <>A 6-digit access code was emailed to <span className="font-medium">{owner.name}</span>.</> : <>A 6-digit access code was created for <span className="font-medium">{owner.name}</span>. Nothing was sent.</>}<br />
                It expires in 15 minutes.
              </p>
            </div>

            {devCode && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-1">No email sent</p>
                <p className="text-xs text-muted-foreground mb-2">Outgoing messages are off on this system. Share this code with the owner yourself only if you choose to:</p>
                <div className="font-mono text-2xl font-bold tracking-widest text-amber-700 dark:text-amber-300">{devCode}</div>
              </div>
            )}

            <Button className="w-full" onClick={handleClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Owners() {
  const { data: owners, isLoading } = useGetOwners();
  const { data: properties } = useGetProperties();
  const ownedBy = (id: number) => (properties ?? []).filter((p: any) => p.ownerId === id);
  const [editorOpen,setEditorOpen]=useState(false);
  const [editingOwner,setEditingOwner]=useState<any>(null);
  const [resetTarget, setResetTarget] = useState<any>(null);
  useEffect(()=>{const id=Number(new URLSearchParams(window.location.search).get('owner'));const record=owners?.find(o=>o.id===id);if(record){setEditingOwner(record);setEditorOpen(true);}},[owners]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Owners</h1>
        <Button onClick={()=>{setEditingOwner(null);setEditorOpen(true);}}>
          <Plus className="h-4 w-4 mr-2" />
          Add Owner
        </Button>
      </div>

      <SuggestedOwners />

      <div className="rounded-xl border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Name</TableHead>
              <TableHead>Properties (management fee)</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead className="hidden lg:table-cell">Portal Access</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  {Array(6).fill(0).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : owners?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                      <Users className="h-7 w-7 text-muted-foreground/40" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">No owners yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Add property owners to give them portal access and send monthly statements.</p>
                    </div>
                    <Button size="sm" className="gap-2 mt-1" onClick={()=>{setEditingOwner(null);setEditorOpen(true);}}>
                      <Plus className="h-4 w-4" /> Add First Owner
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              owners?.map((owner) => (
                <TableRow key={owner.id}>
                  <TableCell className="font-medium align-top">
                    {owner.name}
                    <div className="md:hidden text-xs font-normal text-muted-foreground break-all">{owner.email ?? "No email"}{owner.phone ? ` · ${owner.phone}` : ""}</div>
                  </TableCell>
                  <TableCell className="text-xs align-top">
                    {ownedBy(owner.id).length ? (
                      <ul className="space-y-0.5">
                        {ownedBy(owner.id).map((p: any) => <li key={p.id}><Link href="/properties" className="hover:underline">{p.name}</Link> <span className="text-muted-foreground">({p.managementFee ?? "20"}%)</span></li>)}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">None linked yet. Properties → open a property → Edit → Owner.</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                    {owner.email ? (
                      <span className="flex items-center gap-1.5">
                        <Mail className="h-3 w-3" /> {owner.email}
                      </span>
                    ) : (
                      <span className="text-destructive text-xs flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> No email
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden md:table-cell">{owner.phone ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {owner.email ? (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 text-xs">
                        Email on file
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-xs">
                        No access
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <Button variant="outline" size="sm" onClick={()=>{setEditingOwner(owner);setEditorOpen(true);}}>Edit</Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-teal-600 border-teal-200 hover:bg-teal-50 dark:hover:bg-teal-950/20"
                        onClick={() => setResetTarget(owner)}
                        title="Create a portal access code for this owner"
                      >
                        <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                        Reset Access
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AutoStatementsSettings />

      <ContactEditor kind="owners" open={editorOpen} onOpenChange={setEditorOpen} record={editingOwner}/>
      <ResetAccessDialog
        owner={resetTarget}
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </div>
  );
}
