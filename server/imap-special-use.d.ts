// The lockfile-pinned classifier is shared with ImapFlow's LIST implementation.
declare module "imapflow/lib/special-use.js" {
  export function specialUse(hasSpecialUseExtension: boolean, folder: { name: string; flags: Set<string> }): { flag: string | null };
}
