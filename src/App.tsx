import { translateText, localize, useLanguage } from '@/lib/i18n';
import { AutomaticPayoutReviewProvider } from "./components/AutomaticPayoutReview";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SolanaWalletProvider } from "./solana/SolanaWalletProvider";
import { ArenaThemeProvider } from "./components/ArenaThemeProvider";
import GameLoadingPanel from "./components/GameLoadingPanel";

const Index = lazy(() => import("./pages/Index"));
const Game = lazy(() => import("./pages/Game"));
const OnlineGame = lazy(() => import("./pages/OnlineGame"));
const Funds = lazy(() => import("./pages/Funds"));
const WagerJoin = lazy(() => import("./pages/WagerJoin"));
const NotFound = lazy(() => import("./pages/NotFound"));

const WagerPreview = import.meta.env.DEV ? lazy(() => import('./pages/WagerPreview')) : null;

const queryClient = new QueryClient();

const App = () => {
  useLanguage();
  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ArenaThemeProvider>
        <SolanaWalletProvider>
          <Toaster />
          <Sonner />
          <AutomaticPayoutReviewProvider><BrowserRouter>
            <Suspense fallback={<GameLoadingPanel title={translateText("LOADING ARENA")} subtitle={translateText("Preparing match")} />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/game" element={<Game />} />
                <Route path="/funds" element={<Funds />} />
                <Route path="/join/:gameId" element={<WagerJoin />} />
                {localize(WagerPreview && <Route path="/wager-preview" element={<WagerPreview />} />)}
                <Route path="/game/:gameId" element={<OnlineGame />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter></AutomaticPayoutReviewProvider>
        </SolanaWalletProvider>
      </ArenaThemeProvider>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
