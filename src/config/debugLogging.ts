/**
 * AIST persistent debug logging.
 *
 * DEFAULT: false — normal gameplay.
 *
 * To re-enable detailed logging:
 * 1. Change this value to true.
 * 2. Rebuild and redeploy the application.
 * 3. New memory evaluations and updates will retain debug history.
 *
 * Changing this flag does not recreate past logs.
 * This switch does not disable memory processing,
 * gameplay state, recovery, or API accounting.
 */
export const MEMORY_DEBUG_LOGGING = false;
