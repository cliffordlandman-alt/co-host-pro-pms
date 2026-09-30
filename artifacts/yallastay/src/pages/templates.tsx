import { MessageTemplateSettings, PropertyMessageDetails } from "@/components/MessageTemplateSettings";
import { VARIABLES } from "../../../../lib/guest-automations.mjs";
import { apiFetch } from "@/lib/api-fetch";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Plus, Pencil, Trash2, Loader2, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const VARS = VARIABLES.map(v=>`{{${v}}}`);

const CATEGORIES = [
  { id: "booking", label: "Booking" },
  { id: "check_in", label: "Check-In" },
  { id: "check_out", label: "Check-Out" },
  { id: "payment", label: "Payment" },
  { id: "review", label: "Review" },
  { id: "upsell", label: "Upsell" },
  { id: "incident", label: "Incident" },
  { id: "general", label: "General" },
];

const CAT_COLORS: Record<string, string> = {
  booking: "bg-blue-100 text-blue-700", check_in: "bg-green-100 text-green-700",
  check_out: "bg-orange-100 text-orange-700", payment: "bg-red-100 text-red-700",
  review: "bg-yellow-100 text-yellow-700", upsell: "bg-purple-100 text-purple-700",
  incident: "bg-gray-100 text-gray-700", general: "bg-teal-100 text-teal-700",
};

async function fetchTemplates() {
  const r = await apiFetch(`${API}/api/templates`); if(!r.ok)throw new Error("Template request failed");return r.json();
}

export default function Templates() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", category: "booking", channel: "manual", subject: "", body: "", enabled:false });
  const [copied, setCopied] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });

  useEffect(()=>{if(selected){const latest=templates.find((t:any)=>t.id===selected.id);if(latest)setSelected(latest);}},[templates]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (data.id) {
        const r = await apiFetch(`${API}/api/templates/${data.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
        if(!r.ok)throw new Error("Template request failed");return r.json();
      }
      const r = await apiFetch(`${API}/api/templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if(!r.ok)throw new Error("Template request failed");return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); toast({ title: "Template saved" }); setEditing(false); setShowAdd(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { const r=await apiFetch(`${API}/api/templates/${id}`, { method: "DELETE" });if(!r.ok)throw new Error("Could not delete template"); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); setSelected(null); },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const r=await apiFetch(`${API}/api/templates/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });if(!r.ok)throw new Error("Could not update draft rule");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });

  function copyVar(v: string) {
    navigator.clipboard.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(null), 1500);
  }

  const grouped = CATEGORIES.map(cat => ({ ...cat, items: templates.filter((t: any) => t.category === cat.id) })).filter(g => g.items.length > 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MessageSquare className="h-6 w-6 text-purple-600" /> Message Templates</h1>
          <p className="text-muted-foreground mt-1">{templates.length} templates · Reusable messages with dynamic variables</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-2" /> New Template</Button>
      </div>

      <p className="text-sm text-muted-foreground">Switches enable automatic draft preparation only. Messages are not delivered until a channel is connected. Property overrides replace company defaults with the same name.</p>
      <PropertyMessageDetails/>
      {/* Variables reference */}
      <div className="bg-muted/50 border rounded-xl p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Available Variables (click to copy)</p>
        <div className="flex flex-wrap gap-2">
          {VARS.map(v => (
            <button key={v} onClick={() => copyVar(v)} className="font-mono text-xs bg-background border rounded-md px-2 py-1 hover:bg-primary hover:text-primary-foreground transition-colors flex items-center gap-1">
              {copied === v ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        {/* Left: template list */}
        <div className="space-y-4">
          {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            grouped.map(group => (
              <div key={group.id}>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{group.label}</p>
                <div className="space-y-1">
                  {group.items.map((t: any) => (
                    <div key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => { setSelected(t); setEditing(false); }}
                      onKeyDown={e => e.key === "Enter" && (setSelected(t), setEditing(false))}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${selected?.id === t.id ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">{t.name}</span>
                        <div onClick={e => e.stopPropagation()}>
                          <Switch aria-label={`Prepare drafts: ${t.name}`} checked={t.enabled} onCheckedChange={enabled => toggleMutation.mutate({ id: t.id, enabled })} className="scale-75" />
                        </div>
                      </div>
                      <div className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full mt-1 font-medium ${selected?.id === t.id ? "bg-white/20 text-white" : CAT_COLORS[t.category] ?? "bg-gray-100 text-gray-600"}`}>{t.channel} · {t.category.replace("_", " ")}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right: template preview / editor */}
        <div className="bg-card border rounded-xl p-6">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-4 opacity-30" />
              <p className="font-medium">Select a template to preview</p>
            </div>
          ) : editing ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Editing: {selected.name}</h3>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
              <div><Label>Name</Label><Input defaultValue={selected.name} id="edit-name" /></div>
              <div><Label>Subject (email)</Label><Input defaultValue={selected.subject} id="edit-subject" /></div>
              <div><Label>Message Body</Label>
                <Textarea id="edit-body" defaultValue={selected.body} rows={10} className="font-mono text-sm" />
              </div>
              <Button className="w-full" onClick={() => saveMutation.mutate({
                id: selected.id,
                name: (document.getElementById("edit-name") as HTMLInputElement)?.value,
                subject: (document.getElementById("edit-subject") as HTMLInputElement)?.value,
                body: (document.getElementById("edit-body") as HTMLTextAreaElement)?.value,
              })}>
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Save Template
              </Button>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-lg">{selected.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className={`text-xs ${CAT_COLORS[selected.category] ?? "bg-gray-100 text-gray-600"}`}>{selected.category.replace("_", " ")}</Badge>
                    <Badge variant="outline" className="text-xs capitalize">{selected.channel}</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit</Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(selected.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <MessageTemplateSettings key={`${selected.id}-${selected.propertyId}`} template={selected}/>
              {selected.subject && <div className="text-sm text-muted-foreground mb-3"><span className="font-medium">Subject:</span> {selected.subject}</div>}
              <div className="bg-muted/50 rounded-xl p-4 font-mono text-sm whitespace-pre-wrap leading-relaxed">{selected.body}</div>
            </div>
          )}
        </div>
      </div>

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Template</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Template Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Maintenance Apology" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Channel</Label>
                <Select value={form.channel} onValueChange={v => setForm({ ...form, channel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual review</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Subject (email only)</Label><Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
            <div><Label>Message Body</Label><Textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={8} className="font-mono text-sm" placeholder="Hi {guest_name}! …" /></div>
            <Button className="w-full" onClick={() => saveMutation.mutate(form)} disabled={!form.name || !form.body || saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Create Template
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
