import { z } from 'zod';


export const ExtraTableFieldsSchema = z.object({
  id: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ExtraTableFields = z.infer<typeof ExtraTableFieldsSchema>;