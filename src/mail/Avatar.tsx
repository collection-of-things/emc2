import { memo, useContext, useState } from "react";
import { logoDomain, type Mail, type Provider } from "../../shared/types";
import { PrivacyContext } from "../ui/Privacy";
import { Cloud, Gmail, Mail as MailIcon } from "../ui/icons";
import { mailBrand, providerMarks } from "../ui/provider-marks";

// The account's provider mark: drawn icons for Gmail and iCloud, a bundled
// brand SVG for Fastmail, Yahoo and the IMAP hosts recognized from the
// address domain, and a neutral envelope for anything else.
export function ProviderIcon({ provider, email }: { provider: Provider; email?: string }) {
  const brand = mailBrand(provider, email);
  return (
    <span className={`provider-icon ${provider === "gmail-imap" ? "gmail" : provider}`} data-brand={brand ?? undefined} aria-hidden="true">
      {brand ? (
        <img src={providerMarks[brand]} alt="" draggable={false} />
      ) : provider === "gmail" || provider === "gmail-imap" ? (
        <Gmail />
      ) : provider === "icloud" ? (
        <Cloud />
      ) : (
        <MailIcon color="currentColor" />
      )}
    </span>
  );
}
// A stable tint per sender so one person's mail keeps the same avatar color.
export function avatarTone(address: string): number {
  let hash = 0;
  for (const ch of address.toLowerCase()) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0;
  return Math.abs(hash) % 4;
}

export const Avatar = memo(function Avatar({
  mail,
  provider,
  unread,
}: {
  mail: Pick<Mail, "address" | "sender">;
  provider?: Provider;
  unread?: boolean;
}) {
  const domain = logoDomain(mail.address);
  const [broken, setBroken] = useState(false);
  const { on } = useContext(PrivacyContext);
  const initial = mail.sender.slice(0, 1).toUpperCase();
  return (
    <span className="avatar" data-tone={avatarTone(mail.address)} aria-hidden="true">
      {!on && domain && !broken ? (
        <img
          className="avatar-logo"
          src={`/api/logo/${domain}`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="avatar-letter">
          {on ? "·" : initial}
        </span>
      )}
      {provider && <ProviderIcon provider={provider} />}
      {unread && <i className="unread-dot" aria-hidden="true" />}
    </span>
  );
});
