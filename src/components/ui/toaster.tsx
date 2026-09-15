import { localize, translateText, useLanguage } from '@/lib/i18n';
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  useLanguage();
  const { toasts } = useToast();

  return (
    <ToastProvider label={translateText("Notification")}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{localize(title)}</ToastTitle>}
              {description && <ToastDescription>{localize(description)}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport label={translateText("Notifications ({hotkey})")} />
    </ToastProvider>
  );
}
