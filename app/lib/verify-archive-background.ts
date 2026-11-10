import 'server-only';
import { after } from 'next/server';
import { buildArchive, claimArchiveVerification, type ArchiveSpec, type ArchiveInfo } from './period-archive';
/** Independent of snapshot retention; a persistent lease bounds checks across deployments. */
export async function verifyArchiveInBackground<T>(spec: ArchiveSpec<T>, info?: ArchiveInfo) {
  if (info?.mode !== 'archive') return;
  after(async () => { try {
    const token = await claimArchiveVerification(spec);
    if (token) await buildArchive({ ...spec, onlyIfChanged: true }, token);
  } catch { /* Verification infrastructure never blocks access to an already readable archive. */ } });
}
