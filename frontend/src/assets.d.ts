export interface CatalogueAsset {
  id: number;
  name: string;
  category: string;
  description: string;
  image: string;
  dailyPriceEth: string;
  attributes: Record<string, string>;
}

export const assets: CatalogueAsset[];
