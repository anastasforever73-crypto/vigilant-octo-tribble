// Compatibility export for the original file. Next.js serves the protected handler
// from app/api/google-sheets/route.ts; a root route.ts is not an App Router route.
export { GET, runtime, dynamic } from './app/api/google-sheets/route';
