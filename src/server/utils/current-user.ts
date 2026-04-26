import { getStaffAuthDetails } from '../modules/staff-auth';

/**
 * Resolve the display name and ID of the currently authenticated staff.
 * Falls back to role, then the provided default.
 */
export async function getActorDetails(fallbackName = 'System') {
  try {
    const auth = await getStaffAuthDetails();
    if (auth?.status === 'blocked') return { name: fallbackName, id: null };
    return {
      name: auth?.staff?.name || auth?.staff?.role || fallbackName,
      id: auth?.staff?.id || null
    };
  } catch {
    return { name: fallbackName, id: null };
  }
}

export async function getActorName(fallback = 'System'): Promise<string> {
  const actor = await getActorDetails(fallback);
  return actor.name;
}
