import { z } from "zod";

export const userPushSchema = z.object({
  id: z.uuid(),
  nombre: z.string().trim().min(1).max(200),
  apellido: z.string().trim().min(1).max(200),
  documento: z.string().trim().min(1).max(100),
  phone: z.string().max(50).nullish(),
  phone_previous: z.string().max(50).nullish(),
  email: z.string().max(320).nullish(),
  email_previous: z.string().max(320).nullish(),
  address: z.string().max(500).nullish(),
  address_previous: z.string().max(500).nullish(),
  password: z.string().max(256).nullish(),
  updated_at: z.number().int().nonnegative().optional(),
  deleted: z.boolean().optional(),
});

export type UserPushInput = z.infer<typeof userPushSchema>;

export const clientLogEntrySchema = z.object({
  at: z.number().int().nonnegative(),
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  tag: z.string().max(64),
  message: z.string().max(2000),
});

export const clientLogsSchema = z.object({
  device_id: z.string().min(1).max(64),
  app_version: z.string().max(64),
  base_url: z.string().max(300),
  entries: z.array(clientLogEntrySchema).min(1).max(200),
});

export type ClientLogsInput = z.infer<typeof clientLogsSchema>;
