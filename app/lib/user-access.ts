import { sections, type Section } from './connections/model';

export type Role = 'user' | 'admin';
export const allSections = Object.keys(sections) as Section[];
export type Access = { role: Role; sections: Section[] };
export function canView(access: Access, section: string) {
  return access.role === 'admin' || access.sections.includes((({ movements: 'cash', salary: 'overview', projects: 'cash' } as Record<string, Section>)[section] || section) as Section);
}
export function firstPage(access: Access) {
  const first = access.role === 'admin' ? 'overview' : access.sections[0];
  return !first || first === 'overview' ? '/' : first === 'balance' ? '/balance' : `/?tab=${first}`;
}
export function validSections(value: unknown): value is Section[] {
  return Array.isArray(value) && value.length > 0 && value.length <= allSections.length &&
    value.every(section => typeof section === 'string' && allSections.includes(section as Section)) && new Set(value).size === value.length;
}
