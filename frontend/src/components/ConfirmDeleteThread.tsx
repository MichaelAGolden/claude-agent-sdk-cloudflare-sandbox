import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDeleteThreadProps {
  isOpen: boolean;
  threadTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting?: boolean;
}

export function ConfirmDeleteThread({
  isOpen,
  threadTitle,
  onCancel,
  onConfirm,
  isDeleting = false,
}: ConfirmDeleteThreadProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isDeleting && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete Conversation?
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 space-y-3">
          <p className="text-sm">
            Delete: <span className="font-medium">{threadTitle}</span>
          </p>

          <div className="rounded-md bg-muted p-3 text-sm space-y-2">
            <p className="font-medium">What will be deleted:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Conversation history and context</li>
              <li>AI session transcript data</li>
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            Basic usage data is retained for analytics purposes.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
