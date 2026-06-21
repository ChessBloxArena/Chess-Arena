const PIECE_IDENTITY_PREFERENCE_KEY = 'chess_piece_identity_labels_v1';

function readStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function readPieceIdentityPreference(): boolean {
  const storage = readStorage();
  if (!storage) return false;

  try {
    const raw = storage.getItem(PIECE_IDENTITY_PREFERENCE_KEY);
    if (raw === null) return false;
    return raw === 'true';
  } catch {
    return false;
  }
}

export function savePieceIdentityPreference(showPieceIdentities: boolean): boolean {
  const storage = readStorage();

  try {
    storage?.setItem(PIECE_IDENTITY_PREFERENCE_KEY, String(showPieceIdentities));
  } catch {
    // Preference writes are non-critical; keep gameplay uninterrupted.
  }

  return showPieceIdentities;
}
