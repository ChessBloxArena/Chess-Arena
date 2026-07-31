// Local walkthrough bookkeeping only. Never imports wallet, RPC, or settlement clients.
export type PreviewStep = 'setup' | 'funded' | 'playing' | 'won' | 'claimed' | 'converted';
export interface PreviewWallet { step: PreviewStep; stake: number; eth: number; rblx: number }
export const INITIAL_PREVIEW: PreviewWallet = { step: 'setup', stake: .01, eth: .1, rblx: 0 };
export type PreviewAction = { type: 'stake'; amount: number } | { type: 'fund' | 'play' | 'win' | 'claim' | 'convert' | 'reset' };
const round = (amount: number) => Number(amount.toFixed(6));
export function previewWalletReducer(state: PreviewWallet, action: PreviewAction): PreviewWallet {
  switch (action.type) {
    case 'stake': return state.step === 'setup' && [.005,.01,.025].includes(action.amount) ? { ...state, stake: action.amount } : state;
    case 'fund': return state.step === 'setup' ? { ...state, step:'funded', eth:round(state.eth-state.stake) } : state;
    case 'play': return state.step === 'funded' ? { ...state, step:'playing' } : state;
    case 'win': return state.step === 'playing' ? { ...state, step:'won' } : state;
    case 'claim': return state.step === 'won' ? { ...state, step:'claimed', eth:round(state.eth+state.stake*2) } : state;
    case 'convert': return state.step === 'claimed' ? { ...state, step:'converted', eth:round(state.eth-state.stake*2), rblx:round(state.stake*2*50) } : state;
    case 'reset': return { ...INITIAL_PREVIEW };
  }
}
