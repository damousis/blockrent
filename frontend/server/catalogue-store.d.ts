export const MAX_STORE_BYTES: number;
export type CatalogueStore = Record<string, Record<string, unknown>>;
export function readCatalogueStore(file: string, maxBytes?: number): Promise<CatalogueStore>;
export function updateCatalogueStore(file: string, mutate: (store: CatalogueStore) => void | boolean | Promise<void | boolean>, options?: { maxBytes?: number; lockTimeoutMs?: number }): Promise<void>;
