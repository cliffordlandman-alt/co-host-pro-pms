import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2, AlertTriangle, CheckCircle2, Clock, Upload, Loader2, Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const DOC_TYPES = [
  "Owner Agreement", "Title Deed", "Passport / EID", "DTCM Permit",
  "DEWA Bill", "Empower Bill", "Maintenance Invoice", "Cleaning Invoice",
  "Payment Proof", "Guest Document", "Insurance", "Other",
];

const CATEGORIES = ["property", "owner", "guest", "financial", "legal", "operational", "general"];

async function fetchDocuments() {
  const r = await apiFetch(`${API}/api/documents`);
  return r.json();
}
async function fetchProperties() {
  const r = await apiFetch(`${API}/api/properties`);
  return r.json();
}

function expiryStatus(date?: string | null) {
  if (!date) return null;
  const d = new Date(date);
  const now = new Date();
  const days = Math.ceil((d.getTime() - now.getTime()) / 86400000);
  if (days < 0) return { label: "Expired", color: "bg-red-100 text-red-700", icon: AlertTriangle };
  if (days < 30) return { label: `Expires in ${days}d`, color: "bg-amber-100 text-amber-700", icon: Clock };
  return { label: `Valid until ${d.toLocaleDateString()}`, color: "bg-green-100 text-green-700", icon: CheckCircle2 };
}

export default function Documents() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", type: "", category: "property", propertyId: "", expiryDate: "", notes: "" });

  const { data: docs = [], isLoading } = useQuery({ queryKey: ["documents"], queryFn: fetchDocuments });
  const { data: properties = [] } = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`${API}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, propertyId: form.propertyId ? parseInt(form.propertyId) : null }),
      });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast({ title: "Document added" });
      setShowAdd(false);
      setForm({ name: "", type: "", category: "property", propertyId: "", expiryDate: "", notes: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiFetch(`${API}/api/documents/${id}`, { method: "DELETE" }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
  });

  const filtered = docs.filter((d: any) => {
    const q = search.toLowerCase();
    const matchSearch = !q || d.name.toLowerCase().includes(q) || d.type?.toLowerCase().includes(q) || d.propertyName?.toLowerCase().includes(q);
    const matchCat = catFilter === "all" || d.category === catFilter;
    return matchSearch && matchCat;
  });

  const expiring = docs.filter((d: any) => {
    if (!d.expiryDate) return false;
    const days = Math.ceil((new Date(d.expiryDate).getTime() - Date.now()) / 86400000);
    return days >= 0 && days < 30;
  });
  const expired = docs.filter((d: any) => d.expiryDate && new Date(d.expiryDate) < new Date());

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6 text-blue-600" /> Documents</h1>
          <p className="text-muted-foreground mt-1">{docs.length} documents · {expired.length} expired · {expiring.length} expiring soon</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-2" /> Add Document</Button>
      </div>

      {/* Alerts */}
      {(expired.length > 0 || expiring.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {expired.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div><div className="font-semibold text-red-800 text-sm">{expired.length} Expired Document{expired.length > 1 ? "s" : ""}</div>
              <div className="text-xs text-red-600">{expired.map((d: any) => d.name).slice(0, 2).join(", ")}{expired.length > 2 ? " and more" : ""}</div></div>
            </div>
          )}
          {expiring.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <div><div className="font-semibold text-amber-800 text-sm">{expiring.length} Expiring Soon</div>
              <div className="text-xs text-amber-600">{expiring.map((d: any) => d.name).slice(0, 2).join(", ")}{expiring.length > 2 ? " and more" : ""}</div></div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search documents…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No documents yet</p>
          <p className="text-sm mt-1">Add owner agreements, title deeds, DTCM permits, and more</p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                {["Document", "Type", "Property", "Category", "Expiry", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((doc: any) => {
                const status = expiryStatus(doc.expiryDate);
                const StatusIcon = status?.icon;
                return (
                  <tr key={doc.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        <span className="font-medium">{doc.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{doc.type || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{doc.propertyName || "—"}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className="capitalize text-xs">{doc.category}</Badge></td>
                    <td className="px-4 py-3">
                      {status ? (
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${status.color}`}>
                          {StatusIcon && <StatusIcon className="h-3 w-3" />} {status.label}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(doc.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Document Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Marina Sunrise - DTCM Permit 2026" /></div>
            <div><Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Property (optional)</Label>
              <Select value={form.propertyId} onValueChange={v => setForm({ ...form, propertyId: v })}>
                <SelectTrigger><SelectValue placeholder="Select property…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {properties.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Expiry Date (optional)</Label><Input type="date" value={form.expiryDate} onChange={e => setForm({ ...form, expiryDate: e.target.value })} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes…" /></div>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg text-sm text-muted-foreground">
              <Upload className="h-4 w-4" /> File upload coming soon — document metadata saved now
            </div>
            <Button className="w-full" onClick={() => addMutation.mutate()} disabled={!form.name || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Add Document
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
