// Safe revalidate helper that no-ops outside Next.js.
export async function revalidateTags(tags: string[]) {
  try {
    const { revalidateTag } = await import('next/cache');
    await Promise.all(tags.map((tag) => revalidateTag(tag)));
  } catch {
    // Non-Next runtime (e.g., Express) — ignore
  }
}
