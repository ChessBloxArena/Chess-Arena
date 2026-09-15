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
    <div className="transaction-links">
      {localize(links.map((link) => (
        <a
          key={`${link.kind}-${link.signature}`}
          href={link.explorerUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="transaction-link"
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span>{localize(link.label)}</span><code>{link.signature.slice(0, 8)}…{link.signature.slice(-4)}</code>
        </a>
      )))}
    </div>
  );
}
