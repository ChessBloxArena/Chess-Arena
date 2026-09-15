import { localize, useLanguage } from '@/lib/i18n';
import { ExternalLink } from "lucide-react";
import type { WagerTransactionLink } from "@/lib/wagerSettlement";

interface WagerTransactionLinksProps {
  links: WagerTransactionLink[];
}

export default function WagerTransactionLinks({ links }: WagerTransactionLinksProps) {
  useLanguage();
  if (!links.length) return null;

  return (
    <div className="space-y-1 text-[6px] font-retro text-muted-foreground">
      {localize(links.map((link) => (
        <a
          key={`${link.kind}-${link.signature}`}
          href={link.explorerUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-primary"
        >
          <ExternalLink size={12} />
          {localize(link.label)}: {localize(link.signature.slice(0, 10))}...
        </a>
      )))}
    </div>
  );
}
