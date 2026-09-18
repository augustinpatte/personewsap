import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { WizardProvider } from "@/contexts/WizardContext";
import CanonicalLink from "@/components/CanonicalLink";
import Landing from "./pages/Landing";

// The home page ships in the main bundle; every other route (and the Supabase
// client, phone and country libraries they pull in) loads on demand.
const Index = lazy(() => import("./pages/Index"));
const Verify = lazy(() => import("./pages/Verify"));
const Feedback = lazy(() => import("./pages/Feedback"));
const Login = lazy(() => import("./pages/Login"));
const Account = lazy(() => import("./pages/Account"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Support = lazy(() => import("./pages/Support"));
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <WizardProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <CanonicalLink />
            <Suspense fallback={<div className="min-h-screen bg-background" />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                {/* The former newsletter sign-up wizard. No longer the home page
                    and not linked from it; kept working for existing links. */}
                <Route path="/newsletter" element={<Index />} />
                <Route path="/verify" element={<Verify />} />
                <Route path="/feedback" element={<Feedback />} />
                <Route path="/login" element={<Login />} />
                <Route path="/account" element={<Account />} />
                {/* Public, store-required routes: reachable signed out, and
                    linked from the App Store and Google Play listings. */}
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/support" element={<Support />} />
                <Route path="/delete-account" element={<DeleteAccount />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </WizardProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
