import { z } from "zod";
import { TaskPriority, TaskStatus } from "@prisma/client";

export const taskSchema = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    status: z.nativeEnum(TaskStatus).default(TaskStatus.ToDo),
    priority: z.nativeEnum(TaskPriority).default(TaskPriority.Medium),
    dueDate: z.string().optional().or(z.date().optional()),
    assignedToId: z.string().optional(),
});

export type TaskFormValues = z.infer<typeof taskSchema>;
