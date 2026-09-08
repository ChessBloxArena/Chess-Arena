import { Buffer } from 'buffer';
(globalThis as typeof globalThis & { Buffer?:typeof Buffer }).Buffer ??= Buffer;
void import('./sky-club');
