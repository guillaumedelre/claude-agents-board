import { useState } from "react"
import { Eraser } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const CHOICES = [
  { ms: 0, label: "Désactivé" },
  { ms: 3600e3, label: "Après 1 h d'inactivité" },
  { ms: 86400e3, label: "Après 24 h d'inactivité" },
  { ms: 7 * 86400e3, label: "Après 7 jours d'inactivité" },
]

export function CleanupMenu({ closedCount, autoCleanupMs }: { closedCount: number; autoCleanupMs: number }) {
  const [confirm, setConfirm] = useState(false)

  const setAuto = (value: string) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoCleanupMs: Number(value) }),
    })

  const cleanNow = () => fetch("/api/sessions", { method: "DELETE" })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Eraser />
            <span className="hidden sm:inline">Nettoyage</span>
            {autoCleanupMs > 0 && <span className="size-1.5 rounded-full bg-done" aria-label="Nettoyage automatique actif" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem disabled={closedCount === 0} onSelect={() => setConfirm(true)}>
            <Eraser />
            Retirer les sessions fermées ({closedCount})
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Nettoyage automatique</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(autoCleanupMs)} onValueChange={setAuto}>
            {CHOICES.map((c) => (
              <DropdownMenuRadioItem key={c.ms} value={String(c.ms)} onSelect={(e) => e.preventDefault()}>
                {c.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <p className="px-2 pt-1 pb-1.5 text-[11px] leading-snug text-muted-foreground">
            Retire toute session sans événement depuis ce délai, ouverte ou non. Elle revient au prochain événement qu'elle envoie. Les
            durées gardées pour les estimations ne sont pas effacées.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer {closedCount} session{closedCount > 1 ? "s" : ""} fermée{closedCount > 1 ? "s" : ""} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les sessions fermées et celles sans nouvelles depuis plus de 10 minutes disparaissent du tableau, avec leur journal. Les
              durées gardées pour les estimations de la timeline restent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={cleanNow}>Retirer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
