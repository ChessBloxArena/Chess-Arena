export { PLAY_TERMS_VERSION } from '../../supabase/functions/pvp-referee/playConsent';
import { PLAY_TERMS_VERSION } from '../../supabase/functions/pvp-referee/playConsent';
const KEY = 'chessblox_play_consent:';
export function readPlayConsent(walletAddress: string) {
  try {
    const value = JSON.parse(localStorage.getItem(KEY + walletAddress.toLowerCase()) || 'null');
    return value?.version === PLAY_TERMS_VERSION && Number.isFinite(Date.parse(value.acceptedAt)) ? value as { version: string; acceptedAt: string } : null;
  } catch { return null; }
}
// This is a UI hint only. The referee independently checks its saved consent row.
export function rememberPlayConsent(walletAddress: string, version: string, acceptedAt: string) {
  if (version !== PLAY_TERMS_VERSION || !Number.isFinite(Date.parse(acceptedAt))) return;
  try { localStorage.setItem(KEY + walletAddress.toLowerCase(), JSON.stringify({ version, acceptedAt })); } catch { /* Optional local storage. */ }
  window.dispatchEvent(new Event('chessblox-consent-change'));
}
