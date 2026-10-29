import type { Interface, TransactionReceipt } from "ethers";

export interface AssetDetails {
  name: string;
  category: string;
  description: string;
  image: string;
}
export interface AssetMetadata extends AssetDetails { id: string }
export const categoryImages: Record<string, string>;
export function normalizeDetails(input: unknown): AssetDetails;
export function normalizeMetadata(input: unknown): AssetMetadata;
export function metadataHash(input: unknown): string;
export function parseDailyPrice(input: unknown): bigint;
export function registrationIdFromReceipt(receipt: TransactionReceipt | null, address: string, contractInterface: Interface): string;
export function loadCatalogue(config: { address: string; chainId: number }, ids?: string[]): Promise<AssetMetadata[]>;
export function publishMetadata(metadata: unknown): Promise<void>;
