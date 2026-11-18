export interface DispatchSite {
  file: string;
  line: number;
  fn: string;
  expr?: string;
}
export interface DispatchKeyEntry {
  key: string;
  inAbilityAttrs: boolean;
  callSites: DispatchSite[];
  querySites: DispatchSite[];
}
export function scanAbilityAttrsKeys(root: string): string[];
export function scanDispatchKeys(root?: string): { keys: DispatchKeyEntry[]; dynamic: DispatchSite[] };
