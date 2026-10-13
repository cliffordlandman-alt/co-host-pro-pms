import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { periodQuery, type Period } from "@/lib/income";

// Downloads exactly what the Income per property page shows for the chosen period (read-only).
export function ExportIncome({ period }: { period: Period }) {
  const [busy, setBusy] = useState(false); const { toast } = useToast();
  async function get(format: "xlsx" | "pdf") {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/reports/income/export?${periodQuery(period)}&format=${format}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Export failed (${r.status})`);
      const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || `income-per-property.${format}`;
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } finally { setBusy(false); }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-10" disabled={busy} data-testid="income-export"><Download className="h-4 w-4 mr-1.5" />{busy ? "Exporting…" : "Export"}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => get("xlsx")} data-testid="income-export-xlsx">Excel (.xlsx)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => get("pdf")} data-testid="income-export-pdf">PDF</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
