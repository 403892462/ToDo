import { z } from "zod";

const prioritySchema = z.enum(["low", "medium", "high"]);
const dueAtSchema = z.string().datetime({ offset: true });

export const taskDraftSchema = z.object({
  title: z.string().trim().min(1).max(500),
  dueAt: dueAtSchema.optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  parentId: z.string().uuid().optional(),
  labels: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  priority: prioritySchema.optional(),
});

export const createTasksSchema = z.object({
  tasks: z.array(taskDraftSchema).min(1).max(10),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    dueAt: z.union([dueAtSchema, z.literal("")]).optional(),
    durationMinutes: z.number().int().min(1).max(1440).optional(),
    parentId: z.union([z.string().uuid(), z.literal("")]).optional(),
    labels: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    priority: prioritySchema.optional(),
    completed: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
