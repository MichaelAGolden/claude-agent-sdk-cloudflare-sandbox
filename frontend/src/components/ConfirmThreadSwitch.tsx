import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmThreadSwitchProps {
  isOpen: boolean;
  targetThreadTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmThreadSwitch({
  isOpen,
  targetThreadTitle,
  onCancel,
  onConfirm,
}: ConfirmThreadSwitchProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Switch Conversation?</DialogTitle>
          <DialogDescription>
            The current conversation will be interrupted and saved. You can resume it later.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <p className="text-sm text-muted-foreground">
            Switch to: <span className="font-medium text-foreground">{targetThreadTitle}</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Stay Here
          </Button>
          <Button onClick={onConfirm}>
            Switch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
