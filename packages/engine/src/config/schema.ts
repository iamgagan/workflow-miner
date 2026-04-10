import { z } from "zod";

export const gmailConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
});

export const slackConfigSchema = z.object({
  botToken: z.string().min(1),
});

export const linearConfigSchema = z.object({
  apiKey: z.string().min(1),
});

export const calendarConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
});

export const emailConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive().default(587),
  secure: z.boolean().optional(),
  user: z.string().min(1),
  pass: z.string().min(1),
  toEmail: z.string().email(),
  fromEmail: z.string().email(),
});

export const configSchema = z.object({
  gmail: gmailConfigSchema.optional(),
  slack: slackConfigSchema.optional(),
  linear: linearConfigSchema.optional(),
  calendar: calendarConfigSchema.optional(),
  email: emailConfigSchema.optional(),
});

export type Config = z.infer<typeof configSchema>;
export type GmailConfig = z.infer<typeof gmailConfigSchema>;
export type SlackConfig = z.infer<typeof slackConfigSchema>;
export type LinearConfig = z.infer<typeof linearConfigSchema>;
export type CalendarConfig = z.infer<typeof calendarConfigSchema>;
export type EmailConfig = z.infer<typeof emailConfigSchema>;
