import { useRef, useState } from "react";
import type { RendererMail } from "../../shared/types";
import type { MailIdentity, BulkMailAction, MailBatchResponse, MailBatchResult } from "../../shared/bulk-mail";
import type { Api } from "../api";
import { selectionKey } from "./bulk-selection";

type Outcome = { results: MailBatchResult[]; items: RendererMail[]; refreshFailed?: boolean };

// App owns the job so a pane remount cannot lose its lock or uncertain results.
export function useBulkMailAction() {
  const lock = useRef(false);
  const dismissed = useRef(false);
  const targets = useRef(new Map<string, string>());
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const run = async ({ action, items, until, api, reload, reportRefreshFailure }: {
    action: BulkMailAction; items: RendererMail[]; until?: number; api: Api; reload: () => Promise<unknown>; reportRefreshFailure: () => void;
  }) => {
    if (lock.current || !items.length) return;
    lock.current = true;
    dismissed.current = false;
    targets.current = new Map(items.map(item => [selectionKey(item), item.accountId]));
    setPending(true); setOutcome(null);
    const submitted = items.map(({ id, accountId }) => ({ id, accountId }));
    let results: MailBatchResult[];
    try {
      const response = await api<MailBatchResponse>("/messages/batch", "POST", { items: submitted, operation: { action, ...(until ? { until } : {}) } });
      const returned = new Map(response.results.map(result => [selectionKey(result), result]));
      results = submitted.map(item => returned.get(selectionKey(item)) ?? { ...item, status: "unknown" });
    } catch {
      results = submitted.map(item => ({ ...item, status: "unknown" }));
    }
    const result = { results, items };
    setOutcome(result);
    try { await reload(); } catch {
      if (dismissed.current) reportRefreshFailure();
      else setOutcome({ ...result, refreshFailed: true });
    }
    finally { targets.current.clear(); lock.current = false; setPending(false); }
  };
  const dismissOutcome = () => { dismissed.current = true; setOutcome(null); };
  return { pending, outcome, setOutcome, dismissOutcome, run,
    has: (mail: MailIdentity) => targets.current.has(selectionKey(mail)),
    hasAccount: (accountId: string) => [...targets.current.values()].includes(accountId),
  };
}
