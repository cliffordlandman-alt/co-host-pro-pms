import { apiFetch } from "@/lib/api-fetch";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetReservations } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Send, MessageCircle, User, Building, Sparkles, Globe,
  Phone, Mail, AlertTriangle, CheckCheck, Clock,
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchJson(path: string) {
  const res = await apiFetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error("API error");
  return res.json();
}

const PLATFORM_STYLES: Record<string, { cls: string; label: string; icon: string }> = {
  airbnb:      { cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-200", label: "Airbnb", icon: "🏠" },
  booking_com: { cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200", label: "Booking.com", icon: "🔵" },
  direct:      { cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200", label: "Direct", icon: "✉️" },
  whatsapp:    { cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 border-green-200", label: "WhatsApp", icon: "💬" },
};

const SENTIMENT_CONFIG: Record<string, { cls: string; label: string }> = {
  positive: { cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", label: "😊 Positive" },
  neutral:  { cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400", label: "😐 Neutral" },
  negative: { cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300", label: "😠 Negative" },
};

const AI_REPLY_TEMPLATES: Record<string, string[]> = {
  "extra towels":    [
    "Hi {name}! Of course — I'll have extra towels sent up within the next 30 minutes. Apologies for any inconvenience!",
    "Hi {name}, no problem at all! Our team will drop off extra towels shortly. Let me know if there's anything else you need 😊",
  ],
  "wifi":            [
    "Hi {name}! The WiFi details are: Network: YallaStay_Guest / Password: Welcome2024. If you're still having issues please try restarting the router under the TV unit.",
    "Hi {name}, sorry to hear about the WiFi. Try connecting to the 5GHz network — it tends to be faster. Password is Welcome2024. Let me know if that helps!",
  ],
  "check-in":        [
    "Hi {name}! Check-in is from 3pm. The lockbox code is 2468 — it's located right by the main entrance door. Let me know if you need anything!",
    "Hi {name}, great news — everything is ready for you! The building access code is 1357, and your unit key is in lockbox #4 at the entrance. Welcome! 🌟",
  ],
  "check-out":       [
    "Hi {name}! Check-out is at 11am. Please leave the keys in the lockbox and ensure all windows are closed. We hope you had an amazing stay!",
    "Hi {name}, thanks for being such a great guest! Please drop keys in the lockbox. We'd love a review if you enjoyed your stay 🙏",
  ],
  "default":         [
    "Hi {name}! Thanks for reaching out. I'll look into this right away and get back to you within the hour. Apologies for any inconvenience!",
    "Hi {name}, thank you for your message. Our team is on it — we'll have this sorted for you as soon as possible! 😊",
  ],
};

const QUICK_TEMPLATES = [
  { label: "Check-in Instructions", key: "check-in" },
  { label: "Check-out Reminder", key: "check-out" },
  { label: "WiFi Details", key: "wifi" },
  { label: "Extra Towels", key: "extra towels" },
  { label: "Custom Reply", key: "default" },
];

function getAiReplies(lastMessage: string, guestName: string): string[] {
  const msg = lastMessage.toLowerCase();
  let templates = AI_REPLY_TEMPLATES.default;
  for (const [key, replies] of Object.entries(AI_REPLY_TEMPLATES)) {
    if (msg.includes(key)) { templates = replies; break; }
  }
  const firstName = guestName.split(" ")[0];
  return templates.map(t => t.replace("{name}", firstName));
}

export default function Inbox() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const { data: reservations, isLoading: loadingRes } = useGetReservations();
  const { data: dbMessages, isLoading: loadingMsgs } = useQuery({
    queryKey: ["messages", selectedId],
    queryFn: () => fetchJson(`/api/messages?reservationId=${selectedId}`),
    enabled: !!selectedId && !!reservations?.length,
  });
  const { data: allDbMessages } = useQuery({
    queryKey: ["messages-all"],
    queryFn: () => fetchJson("/api/messages"),
    enabled: !!reservations?.length,
  });

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiFetch(`${API_BASE}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: selectedId, sender: "note", body }),
      });
      if(!res.ok) throw new Error("Could not save note");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", selectedId] });
      queryClient.invalidateQueries({ queryKey: ["messages-all"] });
      setDraft("");
      setShowAiSuggestions(false);
    },
    onError: () => toast({ title: "Could not save note", variant: "destructive" }),
  });

  // Build threads from real reservations; each reservation is a conversation thread
  const threads: any[] = (reservations ?? []).map((r: any) => {
    const resMsgs = (allDbMessages ?? []).filter((m: any) => m.reservationId === r.id);
    const lastMsg = resMsgs.length > 0 ? resMsgs[resMsgs.length - 1] : null;
    const lastAt = lastMsg?.sentAt ?? r.checkIn ?? new Date().toISOString();
    return {
      id: r.id,
      reservationId: r.id,
      guestName: r.guestName ?? "Guest",
      channel: r.platform ?? "direct",
      propertyName: r.propertyName ?? "",
      lastMessage: lastMsg?.body ?? `Check-in ${r.checkIn ?? ""}`,
      lastMessageAt: lastAt,
      bookingRef: r.bookingRef ?? null,
      checkIn: r.checkIn ?? null,
      checkOut: r.checkOut ?? null,
      unread: lastMsg ? lastMsg.sender === "guest" && !lastMsg.readAt : false,
      sentiment: "neutral",
    };
  });
  const visibleThreads = filter === "unread" ? threads.filter(t => t.unread) : threads;
  const selectedThread = threads.find(t => t.id === selectedId) ?? null;
  const selectedRes = reservations?.find(r => r.id === selectedThread?.reservationId);
  const unreadCount = threads.filter(t => t.unread).length;
  const messages = dbMessages ?? [];

  const aiReplies = selectedThread
    ? getAiReplies(selectedThread.lastMessage, selectedThread.guestName)
    : [];

  function handleSend(body: string) {
    if (!body.trim()) return;
    sendMutation.mutate(body.trim());
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex h-[calc(100vh-11rem)] gap-4">

        {/* ── Conversation list ──────────────────────────────── */}
        <div className="w-72 flex-shrink-0 flex flex-col border rounded-xl bg-card overflow-hidden shadow-sm">
          <p className="text-sm text-amber-700 bg-amber-50 border rounded p-3">Messages saved here are internal notes. They are not delivered to guests.</p>
      {/* Header */}
          <div className="px-4 py-3 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Guest Inbox</span>
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">{unreadCount}</span>
                )}
              </div>
            </div>
            {/* Filter tabs */}
            <div className="flex gap-1.5 mt-2.5">
              {(["all", "unread"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex-1 text-[11px] font-medium px-2 py-1 rounded-md transition-colors capitalize ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                >
                  {f} {f === "unread" && unreadCount > 0 ? `(${unreadCount})` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto divide-y">
            {loadingRes ? (
              <div className="p-4 space-y-3">
                {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
              </div>
            ) : visibleThreads.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm space-y-2">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground/20" />
                <p className="font-medium">No conversations yet</p>
                <p className="text-xs text-muted-foreground/70">Internal booking notes. Channel messaging is not connected.</p>
              </div>
            ) : visibleThreads.map(thread => {
              const plat = PLATFORM_STYLES[thread.channel] ?? PLATFORM_STYLES.direct;
              const isSelected = selectedId === thread.id;
              return (
                <button
                  key={thread.id}
                  onClick={() => { setSelectedId(thread.id); setShowAiSuggestions(false); }}
                  className={`w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors group ${isSelected ? "bg-primary/8 border-l-2 border-primary" : ""}`}
                >
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {thread.unread && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0 mt-1" />}
                      <span className={`font-medium text-sm truncate ${thread.unread ? "font-semibold" : ""}`}>{thread.guestName}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {thread.sentiment === "negative" && <AlertTriangle className="h-3 w-3 text-red-400" />}
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: false })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${plat.cls}`}>
                      {plat.icon} {plat.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">{thread.propertyName}</span>
                  </div>
                  <p className={`text-xs truncate ${thread.unread ? "text-foreground" : "text-muted-foreground"}`}>
                    {thread.lastMessage}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Message thread ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col border rounded-xl bg-card overflow-hidden shadow-sm min-w-0">
          {!selectedThread ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <MessageCircle className="h-14 w-14 text-muted-foreground/20" />
              <div className="text-center">
                <p className="font-medium">Select a conversation</p>
                <p className="text-sm mt-1">{visibleThreads.length} active threads · {unreadCount} unread</p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-4 py-3 border-b bg-muted/20">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {selectedThread.guestName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{selectedThread.guestName}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${(PLATFORM_STYLES[selectedThread.channel] ?? PLATFORM_STYLES.direct).cls}`}>
                          {(PLATFORM_STYLES[selectedThread.channel] ?? PLATFORM_STYLES.direct).label}
                        </span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${(SENTIMENT_CONFIG[selectedThread.sentiment] ?? SENTIMENT_CONFIG.neutral).cls}`}>
                          {(SENTIMENT_CONFIG[selectedThread.sentiment] ?? SENTIMENT_CONFIG.neutral).label}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">{selectedThread.bookingRef}</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <Building className="h-3 w-3" />
                        {selectedThread.propertyName}
                        <span>·</span>
                        <Clock className="h-3 w-3" />
                        {selectedThread.checkIn ? format(new Date(selectedThread.checkIn), "MMM d") : "—"} – {selectedThread.checkOut ? format(new Date(selectedThread.checkOut), "MMM d") : "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {(selectedRes as any)?.guestPhone && (
                      <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1">
                        <a href={`tel:${String((selectedRes as any).guestPhone).replace(/[^\d+]/g, "")}`}><Phone className="h-3 w-3" />Call</a>
                      </Button>
                    )}
                    {(selectedRes as any)?.guestEmail && (
                      <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1">
                        <a href={`mailto:${(selectedRes as any).guestEmail}`}><Mail className="h-3 w-3" />Email</a>
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingMsgs ? (
                  Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-12 w-2/3 rounded-2xl" />)
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                    <MessageCircle className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm">No notes yet. External channel messaging is not connected.</p>
                  </div>
                ) : (
                  messages.map((msg: any, idx: number) => {
                    const isHost = msg.sender === "host";
                    return (
                      <div key={msg.id ?? idx} className={`flex ${isHost ? "justify-end" : "justify-start"}`}>
                        {!isHost && (
                          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold mr-2 flex-shrink-0 self-end">
                            {selectedThread.guestName[0]}
                          </div>
                        )}
                        <div className={[
                          "max-w-[72%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                          isHost ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm",
                        ].join(" ")}>
                          <p className="leading-relaxed">{msg.body}</p>
                          <p className={`text-[10px] mt-1.5 ${isHost ? "text-primary-foreground/60 text-right" : "text-muted-foreground"}`}>
                            {isHost ? "You" : selectedThread.guestName.split(" ")[0]}
                            {" · "}
                            {formatDistanceToNow(new Date(msg.at ?? msg.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* AI Suggestions */}
              {showAiSuggestions && aiReplies.length > 0 && (
                <div className="px-4 py-3 border-t bg-violet-50 dark:bg-violet-950/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                    <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">AI Reply Suggestions</span>
                  </div>
                  <div className="space-y-2">
                    {aiReplies.map((reply, i) => (
                      <div key={i} className="bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-2 cursor-pointer hover:border-violet-400 transition-colors"
                        onClick={() => { setDraft(reply); setShowAiSuggestions(false); }}>
                        <p className="text-xs text-foreground leading-relaxed">{reply}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick templates */}
              <div className="px-4 py-2 border-t border-b bg-muted/20 flex gap-1.5 overflow-x-auto">
                <span className="text-[10px] text-muted-foreground self-center flex-shrink-0 mr-1">Quick:</span>
                {QUICK_TEMPLATES.map(t => (
                  <button key={t.key}
                    className="text-[11px] font-medium px-2 py-1 rounded-full bg-background border hover:bg-muted transition-colors flex-shrink-0"
                    onClick={() => {
                      const replies = AI_REPLY_TEMPLATES[t.key] ?? AI_REPLY_TEMPLATES.default;
                      const firstName = selectedThread.guestName.split(" ")[0];
                      setDraft(replies[0].replace("{name}", firstName));
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Compose */}
              <div className="border-t p-3 flex flex-col gap-2">
                <div className="flex gap-2 items-end">
                  <Textarea
                    placeholder="Write an internal note… (Enter to send, Shift+Enter for new line)"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={2}
                    className="flex-1 resize-none text-sm"
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(draft); } }}
                  />
                  <div className="flex flex-col gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setShowAiSuggestions(s => !s)}
                      title="AI reply suggestions"
                    >
                      <Sparkles className={`h-3.5 w-3.5 ${showAiSuggestions ? "text-violet-500" : "text-muted-foreground"}`} />
                    </Button>
                    <Button
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleSend(draft)}
                      disabled={!draft.trim() || sendMutation.isPending}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
