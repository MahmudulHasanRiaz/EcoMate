import { handleApiResponse } from '@/lib/api-helper';

type CreateProductResult = { success: boolean; message?: string; redirect?: string };

export async function createProductClient(formData: FormData): Promise<CreateProductResult> {
  try {
    const response = await fetch('/api/products', {
      method: 'POST',
      body: formData,
    });

    // unwrap ApiResponse.data
    return await handleApiResponse<CreateProductResult>(response);
  } catch (error: any) {
    console.error('createProductClient error:', error);
    return { success: false, message: error.message || 'Network error occurred.' };
  }
}
