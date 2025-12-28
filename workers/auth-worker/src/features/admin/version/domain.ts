import { z } from 'zod';

// Schemas
export const VersionIdSchema = z.string().regex(/^\d+$/, 'Version ID must be a number');

export const VersionSaveResponseSchema = z.object({
  version: z.string(),
  timestamp: z.string(),
  recordCounts: z.object({
    price_policies: z.number(),
    services: z.number(),
    vouchers: z.number(),
  }).optional(),
});

export const VersionInfoSchema = z.object({
  version: z.string(),
  timestamp: z.string().optional(),
  recordCounts: z.object({
    price_policies: z.number(),
    services: z.number(),
    vouchers: z.number(),
  }).optional(),
});

export const VersionDataSchema = z.object({
  version: z.string(),
  timestamp: z.string(),
  data: z.object({
    price_policies: z.array(z.any()),
    services: z.array(z.any()),
    vouchers: z.array(z.any()),
  }),
});

export const VersionListResponseSchema = z.object({
  versions: z.array(VersionInfoSchema),
  total: z.number(),
});

// Types
export type VersionSaveResponse = z.infer<typeof VersionSaveResponseSchema>;
export type VersionInfo = z.infer<typeof VersionInfoSchema>;
export type VersionData = z.infer<typeof VersionDataSchema>;
export type VersionListResponse = z.infer<typeof VersionListResponseSchema>;

// Domain Interfaces
export interface IVersionInfrastructureService {
  saveNewVersion(): Promise<VersionSaveResponse>;
  upgradeVersion(): Promise<VersionInfo>;
  getVersionData(versionId: string): Promise<VersionData>;
  getVersionList(): Promise<VersionListResponse>;
}
