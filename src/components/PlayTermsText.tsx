import { translateText, useLanguage } from '@/lib/i18n';
export default function PlayTermsText() {
  useLanguage();
  return <>
        <p><strong>{translateText("Play for ETH. Receive RBLX if you win.")}</strong>{translateText(" Your stake joins the match pot. A win converts that pot to RBLX Stock Tokens and sends the tokens to your wallet. RBLX represents exposure to Roblox stock; it is not Robux or in-game currency.")}</p>
        <p><strong>{translateText("Check your eligibility.")}</strong>{translateText(" By continuing, you confirm that you meet the ")}<a href="https://docs.robinhood.com/chain/stock-tokens/" target="_blank" rel="noreferrer">{translateText("Stock Token eligibility requirements")}</a>{translateText(", including applicable location restrictions. This statement does not replace any required eligibility checks.")}</p>
        <p><strong>{translateText("Your minimum stays yours.")}</strong>{translateText(" You review the exact minimum for each match. If conversion cannot meet it within 15 minutes after settlement, the full ETH prize is paid instead. Draws and cancelled games return ETH.")}</p>
        <p>{translateText("ChessBlox covers the automatic payout network fee. Your wallet shows the deposit network fee before approval.")}</p>
        <p>{translateText("By selecting ")}<strong>{translateText("Accept & continue")}</strong>{translateText(", you accept the ")}<a href="https://support.uniswap.org/hc/en-us/articles/30935100859661" target="_blank" rel="noreferrer">{translateText("Uniswap Terms")}</a>{translateText(" and ")}<a href="https://support.uniswap.org/hc/en-us/articles/30934457771405" target="_blank" rel="noreferrer">{translateText("Privacy Policy")}</a>{translateText(", confirm your eligibility, and acknowledge the payout conditions above.")}</p>
  </>;
}
