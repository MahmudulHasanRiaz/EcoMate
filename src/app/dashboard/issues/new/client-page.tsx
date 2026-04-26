'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { createIssue } from '@/services/issues';

const issueFormSchema = z.object({
    orderId: z.string().optional(),
    title: z.string().min(5, 'Title must be at least 5 characters.'),
    description: z.string().min(10, 'Please provide a detailed description.'),
    priority: z.enum(['Low', 'Medium', 'High']),
});

type IssueFormValues = z.infer<typeof issueFormSchema>;

export default function NewIssueClientPage() {
    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const orderIdFromQuery = searchParams.get('orderId') || '';

    const issueForm = useForm<IssueFormValues>({
        resolver: zodResolver(issueFormSchema),
        defaultValues: {
            orderId: orderIdFromQuery,
            title: '',
            description: '',
            priority: 'Medium',
        },
    });

    const [isSubmitting, startTransition] = React.useTransition();

    const onSubmit = (data: IssueFormValues) => {
        startTransition(async () => {
            const newIssue = await createIssue(
                data.orderId,
                data.title,
                data.description,
                data.priority
            );
            toast({
                title: 'Issue Created',
                description: `Issue #${newIssue.id} has been created.`,
            });
            router.push(`/dashboard/issues/${newIssue.id}`);
        });
    };

    return (
        <div className="flex flex-1 justify-center px-4 py-8">
            <Card className="w-full max-w-2xl">
                <CardHeader>
                    <CardTitle>Create a New Issue</CardTitle>
                    <CardDescription>
                        Report a new problem and optionally link it to an order.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...issueForm}>
                        <form onSubmit={issueForm.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={issueForm.control}
                                name="orderId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Order Number / ID (optional)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="e.g., 150226-02 or ORD-123" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={issueForm.control}
                                name="title"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Title</FormLabel>
                                        <FormControl>
                                            <Input placeholder="e.g., Wrong product delivered" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={issueForm.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Description</FormLabel>
                                        <FormControl>
                                            <Textarea placeholder="Provide a detailed description of the issue..." {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={issueForm.control}
                                name="priority"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Priority</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select priority" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="Low">Low</SelectItem>
                                                <SelectItem value="Medium">Medium</SelectItem>
                                                <SelectItem value="High">High</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => router.back()}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting ? 'Creating...' : 'Create Issue'}
                                </Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}
